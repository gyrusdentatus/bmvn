# INSTALL

Start with a FRESH install of Ubuntu 22.04 LTS, 2G ram, 2 cores minimum.

### Base System Setup

Hit <enter> to any upgrade questions, defaults are fine.

```
  passwd
  apt-get update
  apt-get dist-upgrade -y
  apt-get install git -y
  apt-get autoremove -y
  reboot
```


### Miner Code Base Setup:

Miner key used in .env must ONLY be used for the miner, nowhere else!

```
  git clone https://github.com/CryptoLinkTech/bmvn.git
  cd miner
  bash scripts/install
  nano .env
  nano chain.config.json
  reboot
```

# RUNNING

### Startup / Reconnect

Just close the shell window to exit, the miner will still be running on the server.

```
  cd miner
  bash scripts/startup
```