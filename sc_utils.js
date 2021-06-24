'use strict';
const device = require('ocore/device.js');
const conf = require('ocore/conf');

// ** send message to all paired bots ** //
async function sendMessage (message, paired_bots) {
	console.error(message);
	for (let user_address of paired_bots) {
		console.error('paired bot address: ', user_address)
		device.sendMessageToDevice(user_address, 'text', message);
	}
	return
}

// ** send greeting messages and check parms when user pairs with the bot ** //
function paired (user_address) {
	device.sendMessageToDevice(user_address, 'text', "Welcome to Obyte Stablecoin V2 bot!");
	device.sendMessageToDevice(user_address, 'text', "Type `operator` to get operator address ");
}

// ** respond to user's message ** //
function respond (user_address, text, operator_address) {
	text = text.trim();  //analyze the text and respond
	// user send operator command
	if ( text.match(/^operator/) )  
		device.sendMessageToDevice(user_address, 'text', "Operator: " + operator_address);
	else if ( text.match(/^params/) ) {   // user send params command
		let base_aas = conf.base_aas, base_aas_list = "base_aas: "
		for (let base_aa of base_aas) {
			base_aas_list += base_aa + ' '
		}
		device.sendMessageToDevice( user_address, 'text', base_aas_list );
		let factory_aas = conf.factory_aas, factory_aas_list = "factory_aas: "
		for (let factory_aa of factory_aas) {
			factory_aas_list += factory_aa + ' '
		}
		device.sendMessageToDevice( user_address, 'text', factory_aas_list );
		if (conf.exclude_curve_aas) {
			let exclude_curve_aas = conf.exclude_curve_aas
			let exclude_curve_aas_list = "exclude_curve_as: "
			for (let excluded_aa of exclude_curve_aas) {
				exclude_curve_aas_list += excluded_aa + ' '
			}
			device.sendMessageToDevice( user_address, 'text', exclude_curve_aas_list );
		}
		device.sendMessageToDevice( user_address, 'text', 
			"interval: " + conf.interval + " seconds" );
	}
	else 
		device.sendMessageToDevice(user_address, 'text', 
			"Unknown command.  Type `operator` to see operator address or `params` to see list of bot parameters." );
}

// ** add Data Feed to Oracle object ** //
async function addDataFeed (oracles, oracle, feed_name, curve_aa) {
	let oracle_data_feed = oracle + ' - ' + feed_name
	if ( !oracles[oracle_data_feed] )  oracles[oracle_data_feed] = {
		oracle: oracle, feed_name: feed_name, curve_aas: [curve_aa]
	}
	else {
		let oracle_data_feed_aas = oracles[oracle_data_feed].curve_aas
		if ( !oracle_data_feed_aas.includes(oracle_data_feed) ) 
			oracles[oracle_data_feed].curve_aas.push(curve_aa)
	}
}

// ** add Oracle Data Feed to Oracles object ** //
async function addOracleDataFeed (oracles, params, curve_aa) {
	if (params.oracle1 && params.feed_name1) await addDataFeed(oracles, params.oracle1, 
		params.feed_name1, curve_aa)
	if (params.oracle2 && params.feed_name2) await addDataFeed(oracles, params.oracle2, 
		params.feed_name2, curve_aa)
	if (params.oracle3 && params.feed_name3) await addDataFeed(oracles, params.oracle3, 
		params.feed_name3, curve_aa)
}

// ** constructDummyObject ** //
async function constructDummyObject (operator, de_aa) {
	let objUnit = {
		unit: 'dummy_trigger_unit',
		authors: [{ address: operator }],
		messages: [
			{	app: 'payment',
				payload: { outputs: [{ address: de_aa, amount: 1e4 }] } 	},
			{	app: 'data',
				payload: { act: 1 } 	}
		]
	}
	return objUnit;
}

exports.paired = paired;
exports.sendMessage = sendMessage;
exports.respond = respond;
exports.addOracleDataFeed = addOracleDataFeed;
exports.constructDummyObject = constructDummyObject;