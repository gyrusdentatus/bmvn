
export DEBIAN_FRONTEND=noninteractive

echo -e "Configuring nodejs.."
. $NVM_DIR/nvm.sh
nvm install 18
nvm alias default 18
nvm use 18

echo -e "Installing yarn.."
curl -sL https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
sudo apt-get update
sudo apt-get purge cmdtest -y
sudo apt-get install -y yarn

echo -e "Installing packages.."
yarn

if [ ! -f chain.config.json ]; then
    echo -e "Copying base config files.."
    cp chain-testnet.config.json.example chain-testnet.config.json
    cp chain.config.json.example chain.config.json
    cp .env.example .env
    
    echo -e "\n\n"
    echo -e "------------------------------------------"
    echo -e " MAKE SURE TO EDIT CONFIG FILES:"
    echo -e "     nano .env"
    echo -e "     nano chain.config.json\n"
    echo -e "        THEN REBOOT!"
    echo -e "------------------------------------------\n\n"    
fi
