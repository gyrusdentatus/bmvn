/**
 * (c) Atlas 2022
 * @author Atlas
 * 
 */
import c from "chalk";
import { createLibp2p } from "libp2p";
import { bootstrap } from "@libp2p/bootstrap";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { mplex } from "@libp2p/mplex";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import * as dotenv from 'dotenv';
import express, { Express, Request, Response } from 'express';

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const figlet = require("figlet");

dotenv.config();

const VERSION = "0.3.0";

const LOG_TRAFFIC = function(log:any) { console.log(log); };

class Overwatch {
    NETWORK:any;
    HEARTBEATS:any = {};

    constructor() {
        this.connectP2P();
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
            try {
                let message = JSON.parse(new TextDecoder().decode(evt.detail.data));
                message.recieved = Math.floor(Date.now() / 1000);
                switch(message.type) {
                    case 'HEARTBEAT':
                        this.HEARTBEATS[message.peerId] = message;
                        break;
                    case 'MESSAGE:REQUEST':
                        break;
                    case 'MESSAGE:SIGNED':
                        break;
                    case 'MESSAGE:EXECUTION':
                        break;
                    case 'PENALTY:TATTLE':
                        break;
                    case 'PENALTY:SIGNED':
                        break;
                    case 'PENALTY:EXECUTION':
                        break;
                }
            } catch(e) {
                return;
            }
        });

        this.NETWORK = node;
    }
    
    /**
     * @param message Message to send to all peers.
     */
    async sendMessage(message:any) {
        message.version = VERSION;
        const cm = Buffer.from(JSON.stringify(message));

        this.NETWORK.pubsub.publish(message.type, cm);
    }
}

const overwatch = new Overwatch();

async function main() {
    const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";

    console.log(c.blue(figlet.textSync("BMVN Overwatch", { horizontalLayout: "full" })));
    console.log("\n", "Version:", VERSION, "\n", "Website:", "https://cryptolink.tech\n", " Author: Atlas\n");


    const app: Express = express();
    const port = 1080;
    
    app.use((req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.header(
          "Access-Control-Allow-Headers",
          "Origin, X-Requested-With, Content-Type, Accept"
        );
        next();
    });

    app.get('/reset/:chain/:id', (req: Request, res: Response) => {
        const chainId = req.params.chain;
        const txId = req.params.id;
        
        const message = {
            type: 'MESSAGE:RESET',
            source: chainId,
            author: 'overwatch',
            transactionHash: txId
        }

        res.send(txId + " reset");
    });

    app.get('/', (req: Request, res: Response) => {
        res.send(overwatch.HEARTBEATS);
    });
      
    app.listen(port, () => {
        console.log('HTTP listening on port', port);
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});