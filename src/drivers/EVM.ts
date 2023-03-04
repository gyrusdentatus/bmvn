/**
 * (c) Atlas 2022
 * @author Atlas
 * 
 * EVM Driver for processing and interacting with EVM chains.
 * 
 */

import { ethers } from "ethers";
import { Queue } from 'typescript-queue'
import c from "chalk";

const abiChain = [
    "event MessageRequest(uint txId, uint destChainId, bytes data)",
    "function isMessageValid(bytes calldata data, address[] calldata signers, bytes[] calldata signatures) external view returns (bool valid)",
    "function messageProcess(uint feeAmount, bytes calldata message, address[] calldata signers, bytes[] calldata signatures) external",
    "function verifySignature(address signer, bytes calldata data, bytes calldata signature) public pure returns (bool)"
];

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const fws  = require('fixed-width-string');

const LOG_TRAFFIC = function(log:any) { console.log(log); };
const LOG_TRAFFIC2 = function(log:any) { console.log(log); };

export default class DriverEVM {
    MINER: any;
    RPC:String = "";
    FINALITY: any;
    CHAIN: any;
    WALLET: any;
    PROVIDER!: any;
    CHAIN_ID: number;
    PUBLIC_KEY: any;
    PRIVATE_KEY: any;
    BLOCK: any;
    SIGNATURES: any = [];
    EXE_QUEUE: any = [];
    TRANSACTORS: any;
    TRANSACTOR_NEXT: any;
    TRANSACTOR_WALLET: any = [];

    brtx: number = 0;
    brrx: number = 0;
    sgtx: number = 0;
    sgrx: number = 0;
    exec: number = 0;
    fail: number = 0;


    /**
     * @param miner Miner node instance
     * @param publicKey Public key of the Miner node
     * @param chainId Chain ID for the Watcher
     */
    constructor(privateKey:any, chainId: number, miner:any, finality:any=10, transactors:any=[]) {
        this.PRIVATE_KEY= privateKey;
        this.FINALITY   = finality;
        this.MINER      = miner;
        this.CHAIN_ID   = chainId;
        this.BLOCK      = 0;
        this.TRANSACTORS= transactors;
        this.TRANSACTOR_NEXT = 0;

        for(let x=0; x < transactors.length; x++) {
            this.EXE_QUEUE[x] = new Queue<any>();
            this.TRANSACTOR_WALLET[x] = new ethers.Wallet(transactors[x].private, this.PROVIDER);
            console.log('TRANSACTOR: ID('+x+')', this.TRANSACTORS[x].public);
        }
    }

    /**
     * @param rpcAddress Address of the chain RPC
     */
    async connect(rpcAddress:string) {
        this.RPC = rpcAddress;

        try {
            this.PROVIDER = new ethers.providers.JsonRpcProvider(rpcAddress);
            this.WALLET   = new ethers.Wallet(this.PRIVATE_KEY, this.PROVIDER);
        } catch(err) {
            console.log('error connecting to RPC for '+this.CHAIN_ID)
        }
        
        this.PROVIDER.on("block", (block: any)=> {
            this.BLOCK = block;
        });

        this.PUBLIC_KEY = await this.WALLET.getAddress();
        this.MINER.PUBLIC_KEY_EVM = this.PUBLIC_KEY;
    }
    
    /**
     * @param contractAddress Chain Miner contract address
     */
    async watch(contractAddress:string) {
        const contract = new ethers.Contract(contractAddress, abiChain, this.PROVIDER);
        this.CHAIN = contract;
            
        const filter = {
            address: contractAddress
        };

        contract.on(filter, async (log) => {
            if(log.event !== 'MessageRequest') return;
            
            const message = {
                type: 'MESSAGE:REQUEST',
                source: this.CHAIN_ID,
                author: this.PUBLIC_KEY,
                block: log.block,
                transactionHash: log.transactionHash,
                data: log
            }

            this.MINER.sendMessage(message);

            LOG_TRAFFIC(
                c.bgYellow('brtx')+' '+fws(c.magenta(this.CHAIN_ID),10)+' '+fws(c.magenta('MESSAGE:REQUEST'), 25)+' '+
                log.transactionHash+' '+this.PUBLIC_KEY
            );
            this.brtx++;
        });

        // process execution queue
        while(1) {
            this.TRANSACTORS.forEach(async (transactor:any, transactorIndex:any) => {
                const message = await this.EXE_QUEUE[transactorIndex].poll();
                if(message) await this.processQueue(transactorIndex, message);
            });

            await sleep(1000);
        }
    }

    /**
     * @param message Message received from the blockchain
     */
    async processMessageRequest(message:any) {
        if(typeof(this.SIGNATURES[message.data.transactionHash]) !== 'undefined') {
            return;
        }
        this.brrx++;

        this.SIGNATURES[message.data.transactionHash] = false; // lock, we're working on it in this thread.

        // pause and wait for enough blocks to pass for finality
        while(true) {
            if(this.BLOCK > (message.data.blockNumber + this.FINALITY)) break;
            await sleep(1000);
        }

        
        // look for and validate the p2p data from on-chain data
        // @note ** this is the security! any changes here must be audited!
        const txnReceipt = await this.PROVIDER.getTransactionReceipt(message.data.transactionHash);
        for(let x=0; x < txnReceipt.logs.length; x++) {
            try {
                const chainData = this.CHAIN.interface.parseLog(txnReceipt.logs[x]);

                if(
                    txnReceipt.blockHash            === message.data.blockHash &&
                    txnReceipt.blockNumber          === message.data.blockNumber &&
                    txnReceipt.transactionHash      === message.data.transactionHash &&
                    chainData.args.txId._hex        === message.data.args[0].hex &&
                    chainData.args.destChainId._hex === message.data.args[1].hex &&
                    chainData.args.data             === message.data.args[2]
                ) {
                    // passed all checks, lets sign it
                    const signature = await this.WALLET.signMessage(ethers.utils.arrayify(ethers.utils.keccak256(message.data.args[2])));
                    this.SIGNATURES[message.data.transactionHash] = signature;
            
                    message.type   = 'MESSAGE:SIGNED';
                    message.author = this.PUBLIC_KEY;
                    message.signer = this.PUBLIC_KEY;
                    message.signature = signature;
                    
                    this.MINER.sendMessage(message);
            
                    LOG_TRAFFIC(
                        c.bgGreen(c.black('sgtx'))+' '+fws(c.magenta(message.source),10)+' '+fws(c.magenta(message.type), 25)+' '+
                        message.data.transactionHash+' '+message.author+' '+message.signature
                    );
                    this.sgtx++;

                    return;
                } else {
                    // todo: this should be a penalty, its known false
                    console.log('INVALID!');
                    return;
                }                
            } catch(e) {}
        }

        // todo: this could be a penalty, transaction does not exist at all
        console.log('UNKNOWN!');
    }

    /**
     * @param message Message received from a peer.
     */
    async processMessageSigned(message:any) {
        // we already executed this, so we are done
        if(typeof(this.MINER.EXECUTED[message.data.transactionHash]) !== 'undefined') {
            return;
        }
        this.sgrx++;

        // we are not a transactor, we do not need to collect other signatures
        if(this.TRANSACTORS.length === 0) return;

        // add signature to basket of miner collected signatures
        if(typeof(this.MINER.SIGNATURES[message.data.transactionHash]) === 'undefined') this.MINER.SIGNATURES[message.data.transactionHash] = {};
        this.MINER.SIGNATURES[message.data.transactionHash][message.signer] = message.signature;

        // transform signatures to be sent to contract
        let signers = [];
        let signatures = [];
        for (let signer in this.MINER.SIGNATURES[message.data.transactionHash]) {
            signers.push(signer);
            signatures.push(this.MINER.SIGNATURES[message.data.transactionHash][signer]);
        }

        message.signatures = signatures;
        message.signers = signers;

        try {
            // if we have the ability to pass the Chain validation function, add it to the processing queue
            if(await this.CHAIN.connect(this.WALLET).isMessageValid(ethers.utils.hexlify(message.data.args[2]), signers, signatures)) {
                // do not execute twice.
                if(typeof(this.MINER.EXECUTED[message.data.transactionHash]) !== 'undefined') return;
                this.MINER.EXECUTED[message.data.transactionHash] = true;

                this.EXE_QUEUE[this.getNextTransactor()].add(message);
            } else {
                // todo: not enough signatures .. _could_ be penalty
            }
        } catch(e:any) {
            console.log(e);
            console.log('TRANSACTION ERROR', message.data.transactionHash);
        }
    }

    async processMessageReset(transactionHash:any) {
        if(typeof(this.MINER.EXECUTED[transactionHash])   !== 'undefined') delete(this.MINER.EXECUTED[transactionHash]);
    }

    async processQueue(transactorIndex:any, message:any) {
        try {
            // estimate gas for transaction
            const gasPrice = await ethers.getDefaultProvider().getGasPrice();
            const gasUnits = (await this.CHAIN.connect(this.TRANSACTOR_WALLET[transactorIndex]).estimateGas.messageProcess(
                ethers.utils.parseEther("1"), 
                ethers.utils.hexlify(message.data.args[2]), 
                message.signers, 
                message.signatures
            )).mul(11).div(10);
            const transactionFee = gasPrice.mul(gasUnits);
            
            // execute transaction
            const tx = await this.CHAIN.connect(this.TRANSACTOR_WALLET[transactorIndex]).messageProcess(
                transactionFee, 
                message.data.args[2], 
                message.signers, 
                message.signatures,
                {
                    gasLimit: gasUnits
                }
            );
            message.execHash = tx.hash;
            message.gasUnits = gasUnits.toString();
            message.gasPrice = gasPrice.toString();
            message.transactionFee = transactionFee.toString();
        } catch(e) {
            this.fail++;
            console.log('EXECUTION FAILURE - requeing', message.data.transactionHash);
            console.log('queue number', transactorIndex);
            console.log(e);
            console.log(message);
            console.log(message.data);
            console.log(message.data.args);
            await this.processMessageReset(message.data.transactionHash);
            await this.processMessageSigned(message);
            return;
        }

        message.type = 'MESSAGE:EXECUTION';
        message.author = this.PUBLIC_KEY;
        message.signer = this.PUBLIC_KEY;
        
        LOG_TRAFFIC2(
            c.bgRed('EXEC')+' '+fws(c.blue(transactorIndex),2)+' '+fws(c.magenta(message.source),10)+' '+fws(c.magenta(message.type), 25)+' '+
            message.data.transactionHash+' '+message.execHash+' '+c.greenBright(ethers.utils.formatEther(message.transactionFee))
        );
        this.exec++;

        this.MINER.sendMessage(message);
    }

    /**
     * @param message Penalty message received from a peer.
     */
    async processPenaltyTattle(message:any) {
        // todo: if valid, then sign and send
    }

    /**
     * @param message Message received from a peer.
     */
    async processPenaltySigned(message:any) {
        // todo send, we need to bee in pool 3
    }

    async getUpstreamVersion() {
        // todo call miner contract to get latest available version
        return '0.3.0';
    }

    getNextTransactor() {
        this.TRANSACTOR_NEXT++;
        if(this.TRANSACTOR_NEXT > this.TRANSACTORS.length) {
            this.TRANSACTOR_NEXT = 0;
        }
        return this.TRANSACTOR_NEXT;
    }
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms || 1000));
}