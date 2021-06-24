/*jslint node: true */
'use strict';
const conf = require('ocore/conf');
const eventBus = require('ocore/event_bus');
const aa_state = require('aabot/aa_state.js');
const network = require('ocore/network.js');
const operator = require('aabot/operator.js');
const dag = require('aabot/dag.js');
const light_data_feeds = conf.bLight ? require('aabot/light_data_feeds.js') : null;
const aa_composer = require("ocore/aa_composer.js");
// ** Utils and other modules ** //
const utils = require('./sc_utils.js');
// ** Vars ** //
let operator_address = null;
let paired_bots = [];
let oracles = {};
let curve_aas = {};
let curve_aas_to_estimate = [];

// ** add new Curve AA ** //
async function addNewCurveAA (curve_aa) {
	// ** check if the Curve AA is in the list to be excluded ** //
	if ( conf.exclude_curve_aas && conf.exclude_curve_aas.includes(curve_aa) ) return false;
	// ** get params of the Curve AA ** //
	let params = await dag.readAAParams(curve_aa);
	if (!params) return false;
	// ** get Fund AA & DE AA ** //
	const fund_aa = await dag.readAAStateVar(curve_aa, 'fund_aa'); 
	const de_aa = await dag.readAAStateVar(curve_aa, 'decision_engine_aa');
	if (!fund_aa || !de_aa) return false;
	// ** add curve AA to the object ** //
	curve_aas[curve_aa] = { curve_aa: curve_aa, de_aa: de_aa }
	// ** follow Curve AA and its associated AAs ** //
	await aa_state.followAA(curve_aa);  
	await aa_state.followAA(fund_aa); 
	await aa_state.followAA(de_aa);  
	//** add AAs Data Feeds to Oracles object ** //
	await utils.addOracleDataFeed(oracles, params, curve_aa)
	return true;
}

// ** when headless wallet is ready, start network and set interval for data feeds check ** //
eventBus.once('headless_wallet_ready', async () => {
	// ** user pairs his device with the bot ** //
	eventBus.on('paired', (from_address, pairing_secret) => {
		paired_bots.push(from_address) // store user address in an array of paired_bots
		utils.paired(from_address) // send a greeting messages & check config params
	});
	// ** respond to the message sent by a user to the bot ** //
	eventBus.on('text', (from_address, text) => {utils.respond(from_address, text, operator_address)});
	
	await operator.start(); // start the built-in wallet
	network.start();  	// start network
	operator_address = operator.getAddress();  // get operator's address
	console.error('************ START WATCHING operator: ', operator_address)
	if (!conf.base_aas || !conf.factory_aas) {  // check for mandatory config params
		console.error('Error: missing mandatory parameters from the config. Process terminated.')
		process.exit(1)
	}

	// ** get all Curve AAs and start following them and all associated AAs ** //
	const curve_aas_array = await dag.getAAsByBaseAAs(conf.base_aas);  // get Curve AAs
	for (let aa of curve_aas_array) { await addNewCurveAA(aa.address) }

	// ** get all stable AAs and start following them ** //
	for (let factory_aa of conf.factory_aas) {
		let factory_aa_vars = await dag.readAAStateVars(factory_aa, "stable_aa_");
		let stable_aas = Object.keys(factory_aa_vars);
		for (let stable_aa of stable_aas) {
			await aa_state.followAA( stable_aa.replace('stable_aa_','') );  // follow Stable AA	
		}		
	}

	// ** emit listeners that will monitor for any new curve AAs ** //
	for (let base_aa of conf.base_aas) {
		await aa_state.followAA(base_aa); // start following Base AA 
		eventBus.on("aa_definition_applied-" + base_aa, (new_curve_aa, definition, objUnit) => {
			if (!curve_aas[new_curve_aa]) addNewCurveAA(new_curve_aa)
		})
	}

	let interval = 60 * 10 //  set interval, e.g. to 10 minutes
	if (conf.interval) interval = conf.interval
	setInterval( () => checkDataFeeds(), interval * 1000);
})

// ** check Data Feeds and call Estiamte & Trigger function if there is change ** //
async function checkDataFeeds() {
	console.error('------------>>>>')
	// ** update data feeds ** //
	curve_aas_to_estimate = []
	let affected_aas = []
	let oracle_obj_keys = Object.keys(oracles);
	for await (let oracle_obj_key of oracle_obj_keys) {
		let oracle = oracles[oracle_obj_key].oracle
		let data_feed = oracles[oracle_obj_key].feed_name
		if (conf.bLight) {
			let updated = await light_data_feeds.updateDataFeed(oracle, data_feed, true);
			if (updated) {
				console.error('INFO: updated Data Feed: ',  data_feed, ' from Oracle: ', oracle)
				affected_aas.push( ...oracles[oracle_obj_key].curve_aas )
			}
		}
	}
	if (affected_aas.length > 0) {
		curve_aas_to_estimate = Array.from(new Set(affected_aas))  // remove duplicates
		await estimateAndTrigger();  // estimate and trigger
	}
	else console.error('INFO: no change in Data Feeds') 
}

// ** estiamte and trigger ** //
async function estimateAndTrigger() {
	const unlock = await aa_state.lock();
	// ** get upcomming state balances and state vars for all aas ** //
	let upcomingBalances = await aa_state.getUpcomingBalances();
	let upcomingStateVars = await aa_state.getUpcomingStateVars();

	// ** for each Curve AA estimate and trigger DE ** //
	for (let curve_aa of curve_aas_to_estimate) {		
		// ** estimate DE response ** //
		let de_aa = curve_aas[curve_aa].de_aa
		let objUnit = await utils.constructDummyObject( operator_address, de_aa)
		let responses = await aa_composer.estimatePrimaryAATrigger(objUnit, de_aa, 
			upcomingStateVars, upcomingBalances);
		// ** process estimated response ** //
		if (responses[0].bounced) console.error('INFO: DE would bounce: ', responses[0].response.error)
		else if (responses[0].response && responses[0].response.responseVars && responses[0].response.responseVars.message) {
			let response = responses[0].response.responseVars.message;
			if (response === "DE fixed the peg"  || response === "DE partially fixed the peg") {
				await dag.sendAARequest(de_aa, {act: 1}); // trigger DE
				console.error('*************************')
				let message = 'INFO: DE Triggered for AA: ' + curve_aa
				await utils.sendMessage(message, paired_bots);
				console.error('*************************')
			}
			else console.error('INFO: ', response, ' DE: ', de_aa, ' for Curve AA: ', curve_aa)
		}
		else console.error(`--- estimated responses to simulated DE AA request`, 
			JSON.stringify(responses, null, 2));
	}
	unlock();
}

process.on('unhandledRejection', up => {
	console.error('unhandledRejection event', up, up.stack);
	throw up;
});