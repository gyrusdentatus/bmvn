#!/bin/bash

# Function to check for sudo privileges
check_sudo() {
    if [[ $(id -u) -ne 0 ]]; then
        echo "This script requires sudo privileges."
        exit 1
    fi
}

# Function to install dependencies
install_dependencies() {
    echo "Updating and installing required packages..."
    sudo apt-get update -qq && sudo apt-get install -yq \
        apt-transport-https \
        build-essential \
        ca-certificates \
        curl \
        git \
        libssl-dev \
        wget \
        gnupg \
        screen
}

# Function to install the latest Node.js and Yarn
install_node () {
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash > /dev/null 2>&1 || echo "FUCK"
}
# Function to copy files with user confirmation for overwriting
copy_files() {
    local src_files=("chain-testnet.config.json.example" "chain.config.json.example" ".env.example")
    local dest_files=("chain-testnet.config.json" "chain.config.json" ".env")
    
    for i in "${!src_files[@]}"; do
        if [[ -f "${dest_files[i]}" ]]; then
            printf "File %s exists. Overwrite? (y/N): " "${dest_files[i]}"
            read -r answer
            if [[ $answer =~ ^[Yy]$ ]]; then
                cp "${src_files[i]}" "${dest_files[i]}"
            fi
        else
            cp "${src_files[i]}" "${dest_files[i]}"
        fi
    done
}

start_process() {
    # Start the command in the background
    npx ts-node --esm src/index.ts &
    local pid=$!

    # Function to gracefully kill the process
    local cleanup() {
        echo "Gracefully terminating the process..."
        kill "$pid"
        wait "$pid"  # Optional: wait for the process to finish
    }

    # Trap SIGINT (Ctrl+C) and SIGTERM (termination signal) to call cleanup
    trap cleanup SIGINT SIGTERM

    # Wait for the process to finish
    wait "$pid"
}

# Main script execution
check_sudo
install_dependencies
install_node
copy_files
# Run the web or whatever it is 
start_process
echo "Setup completed successfully."
