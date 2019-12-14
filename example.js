"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const contract_addresses_1 = require("@0x/contract-addresses");
const order_utils_1 = require("@0x/order-utils");
const contracts_coordinator_1 = require("@0x/contracts-coordinator");
const subproviders_1 = require("@0x/subproviders");
const request = require("request-promise");
const WebSocket = require("ws");
const bignumber_js_1 = require("bignumber.js");
async function example() {
    const headers = {
        "Content-Type": "application/json",
        "Accept": "text/json"
    };
    const chainId = 3; // Ropsten
    const chainName = "ropsten";
    const market = "WETH-DAI";
    // I.e. Infura, Alchemy etc
    const httpProvider = "https://eth-ropsten.alchemyapi.io/jsonrpc/Zu1dAPPWZ4bzN7iEGji0496YX_o7fVDx";
    // Wallet private key / address
    const walletKey = "f2f48ee19680706196e2e339e5da3491186e0c4c5030670656b0e0164837257d";
    const walletAddress = "0x5409ed021d9299bf6814279a6a1411a7e866a631";
    // ZeroEx contract addresses for chain
    const addresses = contract_addresses_1.getContractAddressesForChainOrThrow(chainId);
    const provider = new subproviders_1.Web3ProviderEngine();
    provider.addProvider(new subproviders_1.PrivateKeyWalletSubprovider(walletKey));
    provider.addProvider(new subproviders_1.RPCSubprovider(httpProvider));
    provider._ready.go();
    // Coordinator client library
    const coordinator = new contracts_coordinator_1.CoordinatorClient(addresses.coordinator, provider, chainId);
    var websocketPromises = [];
    const restCancelCompleted = new Promise(function (resolve, reject) {
        websocketPromises.push({ resolve: resolve, reject: reject });
    });
    const coordinatorCancelComplete = new Promise(function (resolve, reject) {
        websocketPromises.push({ resolve: resolve, reject: reject });
    });
    // REST API Websocket
    const restWs = new WebSocket("https://rest.bamboorelay.com/0x/ws");
    restWs.onmessage = function (message) {
        const json = JSON.parse(message.data);
        if ('motd' in json) {
            console.log("Recieved MOTD from REST API WebSocket");
            console.log(json.motd);
        }
        else if ('type' in json && json.type === "SUBSCRIBE") {
            console.log("Subscribed to " + market + " market on REST API WebSocket");
        }
        else if ('actions' in json && json.actions[0].action === "NEW") {
            console.log("New order event  on REST API WebSocket:");
            console.dir(json, { depth: 6 });
        }
        else if ('actions' in json && json.actions[0].action === "CANCEL") {
            console.log("Cancel order event on REST API WebSocket:");
            console.dir(json, { depth: 6 });
            websocketPromises[0].resolve();
        }
    };
    restWs.onopen = function () {
        // Subscribe to market events
        restWs.send(JSON.stringify({
            "type": "SUBSCRIBE",
            "topic": "BOOK",
            "market": market,
            "requestId": 1,
            "networkId": chainId
        }));
    };
    // Coordinator server Websocket
    const coordinatorWs = new WebSocket("https://coordinator.bamboorelay.com/v2/requests?chainId=" + chainId);
    coordinatorWs.onmessage = function (data) {
        const message = JSON.parse(data.data);
        if ('type' in message) {
            switch (message.type) {
                case "CANCEL_REQUEST_ACCEPTED":
                    console.log("Coordinator server accepted order soft cancel");
                    console.dir(message, { depth: 6 });
                    websocketPromises[1].resolve();
                    break;
                case "FILL_REQUEST_RECEIVED":
                    console.log("Coordinator server accepted order fill");
                    console.dir(message, { depth: 6 });
                    break;
            }
        }
    };
    // Request unsigned limit order to SELL 1 of DAI at a price of 1
    const unsignedOrder = await request({
        url: "https://rest.bamboorelay.com/" + chainName + "/0x/markets/" + market + "/order/limit",
        method: "POST",
        headers: headers,
        gzip: true,
        json: {
            type: "SELL",
            quantity: "1",
            price: "1",
            expiration: "11111111111111",
            useCoordinator: true
        }
    });
    console.log("Recieved unsigned limit order:");
    console.dir(unsignedOrder, { depth: 4 });
    unsignedOrder.makerAddress = walletAddress;
    // Need to wrap numeric fields as BigNumbers to ensure it signs correctly
    unsignedOrder.expirationTimeSeconds = new bignumber_js_1.default(unsignedOrder.expirationTimeSeconds);
    unsignedOrder.makerFee = new bignumber_js_1.default(unsignedOrder.makerFee);
    unsignedOrder.makerAssetAmount = new bignumber_js_1.default(unsignedOrder.makerAssetAmount);
    unsignedOrder.takerFee = new bignumber_js_1.default(unsignedOrder.takerFee);
    unsignedOrder.takerAssetAmount = new bignumber_js_1.default(unsignedOrder.takerAssetAmount);
    unsignedOrder.salt = new bignumber_js_1.default(unsignedOrder.salt);
    // Sign the order using the setup provider / private key
    const signedOrder = await order_utils_1.signatureUtils.ecSignOrderAsync(provider, unsignedOrder, walletAddress);
    console.log("Signed order is:");
    console.dir(signedOrder, { depth: 4 });
    const submissionResult = await request({
        url: "https://rest.bamboorelay.com/" + chainName + "/0x/orders",
        method: "POST",
        headers: headers,
        gzip: true,
        json: signedOrder,
        resolveWithFullResponse: true
    });
    if (submissionResult.statusCode !== 201) {
        throw "Failed to create order";
    }
    console.log("Submitted order to REST API");
    const cancelResult = await coordinator.batchSoftCancelAsync([signedOrder]);
    console.log("Cancelled order using the Coordinator Server");
    console.dir(cancelResult, { depth: 4 });
    await Promise.all([
        restCancelCompleted,
        coordinatorCancelComplete
    ]);
    restWs.close();
    coordinatorWs.close();
    console.log("Example completed.");
    process.exit();
}
example();
