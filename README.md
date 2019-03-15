# Liquid Long Position Closure Client

## Build
```
npm install
npm run build
```
This will copy some dependencies into the `output` directory and compile the typescript into the same directory.

## IPFS Build

start IPFS daemon inside a docker container (note: this step will leave IPFS running, you won't need to repeat in the future)
```
docker container run -d --restart=on-failure --name ipfs --mount 'type=volume,source=ipfs-export,dst=/export' --mount 'type=volume,source=ipfs,dst=/data/ipfs' -p 4001:4001 -p 8080:8080 ipfs/go-ipfs
```
build the project inside a docker container (controlled environment)
```
docker image build --tag liquid-long-client-ipfs-deployer .
```
copy the files to IPFS volume
```
docker container run --rm -it --mount 'type=volume,source=ipfs-export,dst=/export' liquid-long-client-ipfs-deployer
```
hash and pin the files in running IPFS instance
```
docker container exec -it ipfs ipfs add --recursive --pin=true /export/liquid-long-client
```

## Run
Once built, you can simply serve the `output` directory.  Optionally, you can use `http-server` which is included as a dev dependency:
```
npx http-server output
```

## How it works

This project uses ES2015 modules and a shim for the pending ES vNext import maps (https://github.com/WICG/import-maps).  There are no existing build tools for this sort of thing, so currently a few NPM scripts are used to copy the necessary dependencies into the build output so they can be found without having to make the entire node_modules directory tree available.  There is no bundling done, so it is recommended to host this with an HTTP/2 friendly fileserver (ideally one that automatically manages pre-fetching).  Without minification or bundling the whole project comes in at about 206 KB on the wire gzipped spread across ~20 requests (can get down to 1 request with a good HTTP/2 prefetch configuration).
