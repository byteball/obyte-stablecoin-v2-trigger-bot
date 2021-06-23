/*jslint node: true */
"use strict";

// these can be overridden with conf.json file in data folder
exports.deviceName = 'Obyte Stablecoin V2 Esitmate and Trigger Bot';
exports.bLight = true;
exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.bNoPassphrase = true;
exports.bIgnoreUnpairRequests = true;
exports.payout_address = ''; // where Bytes can be moved manually.
exports.admin_email = '';
exports.from_email = '';
exports.permanent_pairing_secret = '*'; // * allows to pair with any code
exports.control_addresses = [''];  // if required, add to local conf.json file
//
exports.base_aas = ['3DGWRKKWWSC6SV4ZQDWEHYFRYB4TGPKX', 'CD5DNSVS6ENG5UYILRPJPHAB3YXKA63W']; 
exports.factory_aas = ['CX56T625MQDCRCQTJGYZYYWUAMCEZT2Q','YSVSAICPH5XOZPZL5UVH56MVHQKMXZCM'];
exports.exclude_curve_aas = ['PU5YFREC4OBEYADLOHMBEEA4CI2Z5AKA'];
exports.interval = 60 * 10; // 60 seconds * 10 = 10 minutes
//
// do not change
exports.bSingleAddress = true;
exports.bStaticChangeAddress = true; 
exports.storage = 'sqlite';
exports.KEYS_FILENAME = 'keys.json';
//
console.log('finished conf');
