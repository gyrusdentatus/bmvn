#!/bin/bash

while true; do

    git pull && yarn &&
    npx ts-node --esm src/index.ts && wait

done