/**
 * (c) Atlas 2022
 * @author Atlas
 * 
 */
import DriverEVM from "./drivers/EVM.js";
import c from "chalk";
import { createLibp2p } from "libp2p";
import { bootstrap } from "@libp2p/bootstrap";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { mplex } from "@libp2p/mplex";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import fs from 'fs';
import * as dotenv from 'dotenv';


import { createRequire } from "module";
const require = createRequire(import.meta.url);

const figlet = require("figlet");
const fws = require("fixed-width-string");
const os = require('os');

dotenv.config();

const VERSION = "0.3.0";

let CONFIG:any;
let CONTRACTS:any;
let TRANSACTORS:any = [];
if(process.env.NODE_ENV === 'development') {
    if(fs.existsSync('transactors-testnet.config.json')) {
        TRANSACTORS = require('../transactors-testnet.config.json');
    }
    CONFIG = require('../chain-testnet.config.json');
    CONTRACTS = require('../contracts-testnet.config.json');
} else if (process.env.NODE_ENV === 'test') {
    if(fs.existsSync('transactors-test.config.json')) {
        TRANSACTORS = require('../transactors-test.config.json');
    }
    CONFIG = require('../chain-test.config.json');
    CONTRACTS = require('../contracts-test.config.json');
} else {
    if(fs.existsSync('transactors.config.json')) {
        TRANSACTORS = require('../transactors.config.json');
    }
    CONFIG = require('../chain.config.json');
    CONTRACTS = require('../contracts.config.json');
}

const LOG_TRAFFIC = function(log:any) { console.log(log); };

async function main() {
    const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";

    console.log(c.blue(figlet.textSync("CryptoLink Miner", { horizontalLayout: "full" })));
    console.log("\n", "Version:", VERSION, "\n", "Website:", "https://cryptolink.tech\n", " Author: Atlas\n");

    const miner = new Miner(PRIVATE_KEY_EVM);
}

class Miner {
    PRIVATE_KEY_NODE:any;
    PUBLIC_KEY_NODE:any;

    PRIVATE_KEY_EVM:String;
    PUBLIC_KEY_EVM:String = "";

    NETWORK:any;
    PEERS:any      = [];
    DRIVERS:any    = [];
    SIGNATURES:any = [];
    EXECUTED:any   = [];

    /**
     * @param publicKeyEVM Public key of the miner node that is registered with TBaaS contract
     * @param bootStrap List of network bootstrap nodes to overide the default
     */
    constructor(privateKeyEVM:String, bootStrap:string[]=[]) {
        this.PRIVATE_KEY_EVM = privateKeyEVM;

        // wait for p2p network to load before attempting to start chain drivers
        this.connectP2P().then(() => {
            this.loadChainDrivers();
        });

        setInterval(() => {
            this.sendHeartbeat();
        }, 0.5 * 60 * 1000);
    }

    async connectP2P() {
        const bootstrapers = [
            '/ip4/168.119.79.44/tcp/2323/p2p/QmYMxFJAWQfwM3nWCChySdJSn4X9T4tkkTuUgYKaQXytg8',
        ]

        const node = await createLibp2p({
            addresses: {
                listen: [`/ip4/0.0.0.0/tcp/0`]
            },
            transports: [tcp()],
            connectionEncryption: [noise()],
            streamMuxers: [mplex()],
            peerDiscovery: [
                bootstrap({ list: bootstrapers }),
                pubsubPeerDiscovery()
            ],
            pubsub: gossipsub({ emitSelf: true, enabled: true }),
            connectionManager: {
                autoDial: true,
                maxConnections: 1024,
                minConnections: 1024,
                pollInterval: 2000,            
            },
            relay: {
                enabled: true,
                hop: {
                  enabled: true,
                  active: true
                },
                advertise: {
                  bootDelay: 30 * 60 * 1000,
                  enabled: true,
                  ttl: 5 * 60 * 1000
                }
            },    
        });
    
        await node.start()
    
        node.getMultiaddrs().forEach((addr:any) => {
            console.log('listening on addresses:', addr.toString())
        })

        node.pubsub.subscribe('HEARTBEAT');

        node.pubsub.subscribe('MESSAGE:REQUEST');
        node.pubsub.subscribe('MESSAGE:SIGNED');
        node.pubsub.subscribe('MESSAGE:EXECUTION');

        node.pubsub.subscribe('PENALTY:TATTLE');
        node.pubsub.subscribe('PENALTY:SIGNED');
        node.pubsub.subscribe('PENALTY:EXECUTION');

        node.pubsub.addEventListener('message', async (evt) => {
            if(evt.detail.topic === '_peer-discovery._p2p._pubsub') return;
            if(evt.detail.topic === 'HEARTBEAT') return;
         
            let message;
            try {
                message = JSON.parse(new TextDecoder().decode(evt.detail.data));
            } catch(e) {
                console.log(e);
                console.log(evt.detail.data.toString());
                return;
            }

            // ignore finished messages
            if(typeof(this.EXECUTED[message.data.transactionHash]) !== 'undefined') return;

            switch(evt.detail.topic) {
                case 'MESSAGE:REQUEST':
                    LOG_TRAFFIC(
                        c.yellow('brrx')+' '+fws(c.magenta(message.source),10)+' '+fws(c.magenta(message.type), 25)+' '+
                        message.data.transactionHash+' '+message.author
                    );

                    await this.DRIVERS[message.source].processMessageRequest(message);
                    break;
                case 'MESSAGE:SIGNED':
                    LOG_TRAFFIC(
                        c.green('sgrx')+' '+fws(c.magenta(message.source),10)+' '+fws(c.magenta(message.type), 25)+' '+
                        message.data.transactionHash+' '+message.author+' '+message.signature
                    );

                    await this.DRIVERS[message.source].processMessageSigned(message);
                    break;
                case 'MESSAGE:EXECUTION':
                    this.EXECUTED[message.data.transactionHash] = true;

                    LOG_TRAFFIC(
                        c.red('EXEC')+' '+fws(c.magenta(message.source),10)+' '+fws(c.magenta(message.type), 25)+' '+
                        message.data.transactionHash+' '+message.author+' '+message.signature
                    );
                    // @note we don't need to pass to chain driver, we are done at this point
                    break;
                case 'MESSAGE:RESET':                    
                    LOG_TRAFFIC(
                        c.red('RSET')+' '+fws(c.magenta(message.source),10)+' '+fws(c.magenta(message.type), 25)+' '+
                        message.data.transactionHash+' '+message.author+' '+message.signature
                    );

                    await this.DRIVERS[message.source].processMessageReset(message);
                    break;

                case 'PENALTY:TATTLE':
                    LOG_TRAFFIC(
                        c.red('TATL')+' '+fws(c.magenta(message.source),10)+' '+fws(c.magenta(message.type), 25)+' '+
                        message.data.transactionHash+' '+message.author+' '+message.signature
                    );

                    await this.DRIVERS[message.source].processPenaltyTattle(message);
                    break;
                case 'PENALTY:SIGNED':
                    LOG_TRAFFIC(
                        c.green('PSIG')+' '+fws(c.magenta(message.source),10)+' '+fws(c.magenta(message.type), 25)+' '+
                        message.data.transactionHash+' '+message.author+' '+message.signature
                    );
    
                    await this.DRIVERS[message.source].processPenaltySigned(message);
                    break;
                case 'PENALTY:EXECUTION':
                    LOG_TRAFFIC(
                        c.red('PEXE')+' '+fws(c.magenta(message.source),10)+' '+fws(c.magenta(message.type), 25)+' '+
                        message.data.transactionHash+' '+message.author+' '+message.signature
                    );
                    // @note we don't need to pass to chain driver, we are done at this point
                    break;
            }
        });

        this.NETWORK = node;
    }
    
    async loadChainDrivers() {       
        for(let key in CONFIG) {
            const chainId = Number(CONFIG[key].id);
            
            if(typeof(CONTRACTS[key]) === 'undefined' || CONTRACTS[key].chain === "") continue;
            
            console.log('loading', CONFIG[key].type, 'driver for', CONFIG[key].name, '('+chainId+')');
            if(CONFIG[key].type === 'EVM') {
                this.DRIVERS[chainId] = new DriverEVM(this.PRIVATE_KEY_EVM, chainId, this, CONFIG[key].finality ?? 0, TRANSACTORS);
            } else {
                console.log('unknown driver', CONFIG[key].type, 'for', CONFIG[key].name, '('+chainId+')');
                continue;
            }

            try {
                this.DRIVERS[chainId].connect(CONFIG[key].rpc);
                this.DRIVERS[chainId].watch(CONTRACTS[key].chain);
            } catch(err) {
                console.log('invalid configuration for', key);
                delete this.DRIVERS[chainId];
            }
        }
    }

    /**
     * @param message Message to send to all peers.
     */
    async sendMessage(message:any) {
        message.version = VERSION;
        const cm = Buffer.from(JSON.stringify(message));

        this.NETWORK.pubsub.publish(message.type, cm);
    }

    async sendHeartbeat() {
        try {
            const peers = this.NETWORK.getPeers();
            const conns = this.NETWORK.getConnections();
            
            let chainInfo = [];
            for(let chainId in this.DRIVERS) {
                const fees = await this.DRIVERS[chainId].PROVIDER.getFeeData();
                chainInfo.push({
                    id: chainId,
                    key: this.DRIVERS[chainId].PUBLIC_KEY,
                    rpc: this.DRIVERS[chainId].RPC,
                    block: this.DRIVERS[chainId].BLOCK,
                    txqueue: this.DRIVERS[chainId].EXE_QUEUE.length || 0,
                    brtx: this.DRIVERS[chainId].brtx,
                    brrx: this.DRIVERS[chainId].brrx,
                    sgrx: this.DRIVERS[chainId].sgrx,
                    sgtx: this.DRIVERS[chainId].sgtx,
                    exec: this.DRIVERS[chainId].exec,
                    fail: this.DRIVERS[chainId].fail,
                    nonce: await this.DRIVERS[chainId].PROVIDER.getTransactionCount(this.DRIVERS[chainId].PUBLIC_KEY),
                    fees: {
                        gasPrice: fees.gasPrice ? fees.gasPrice.toString() : "",
                        lastBaseFeePerGas: fees.lastBaseFeePerGas ? fees.lastBaseFeePerGas.toString() : "",
                        maxFeePerGas: fees.maxFeePerGas ? fees.maxFeePerGas.toString() : "",
                        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ? fees.maxPriorityFeePerGas.toString() : ""
                    }
                });
            }

            let connInfo = [];
            for(let x=0; x < conns.length; x++) {
                connInfo.push({
                    id: conns[x].id,
                    remoteAddr: conns[x].remoteAddr,
                    remotePeer: conns[x].remotePeer,
                    status: conns[x].stat.status,
                    direction: conns[x].stat.direction,
                    opened: conns[x].stat.timeline.open,
                    multiplexer: conns[x].stat.multiplexer,
                    encryption: conns[x].stat.encryption
                });
            }

            let message = {
                type: 'HEARTBEAT',
                author: this.PUBLIC_KEY_EVM,
                peerId: this.NETWORK.peerId,
                peers: peers,
                conns: connInfo,
                chains: chainInfo,
                system: {
                    platform: os.platform(),
                    release: os.release(),
                    cpus: os.cpus(),
                    mem: os.totalmem(),
                    memfree: os.freemem(),
                    load: getAverageCPUUsage()
                }            
            };
            
            this.sendMessage(message);
        } catch (e) {
            return;
        }
    }
}

let timesBefore = os.cpus().map((c:any) => c.times);
function getAverageCPUUsage() {
    let timesAfter = os.cpus().map((c:any) => c.times);
    let timeDeltas = timesAfter.map((t:any, i:any) => ({
        user: t.user - timesBefore[i].user,
        sys: t.sys - timesBefore[i].sys,
        idle: t.idle - timesBefore[i].idle
    }));

    timesBefore = timesAfter;

    return timeDeltas
        .map((times:any) => 1 - times.idle / (times.user + times.sys + times.idle))
        .reduce((l1:any, l2:any) => l1 + l2) / timeDeltas.length;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});