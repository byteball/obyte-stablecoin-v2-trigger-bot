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
	utils.addOracleDataFeed(oracles, params, curve_aa)
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
	for (let aa of curve_aas_array) { 
		await addNewCurveAA(aa.address) 
	}

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

	let interval = 60 * 5 //  set interval, e.g. to 5 minutes
	if (conf.interval) interval = conf.interval
	setInterval( () => checkDataFeeds(), interval * 1000);
	checkDataFeeds();
})

// ** check Data Feeds and call Estiamte & Trigger function if there is change ** //
async function checkDataFeeds() {
	console.error('------------>>>>')
	// ** update data feeds ** //
	let affected_aas = []
	for (let oracle_obj_key in oracles) {
		let { oracle, feed_name, curve_aas } = oracles[oracle_obj_key];
		if (conf.bLight) {
			try {
				let updated = await light_data_feeds.updateDataFeed(oracle, feed_name, true);
				if (updated) {
					console.error('INFO: updated Data Feed: ',  feed_name, ' from Oracle: ', oracle)
					affected_aas.push( ...curve_aas )
				}
			} catch (err) { 
				console.error('Error getting Data Feed: ', feed_name, ' from oracle: ', oracle)
				console.error(err) 
			}			
		}
	}
	if (affected_aas.length > 0) {
		const curve_aas_to_estimate = Array.from(new Set(affected_aas))  // remove duplicates
		await estimateAndTrigger(curve_aas_to_estimate);  // estimate and trigger
	}
	else console.error('INFO: no change in Data Feeds') 
}

// ** estiamte and trigger ** //
async function estimateAndTrigger(curve_aas_to_estimate) {
	const unlock = await aa_state.lock();
	// ** get upcomming state balances and state vars for all aas ** //
	let upcomingBalances = aa_state.getUpcomingBalances();
	let upcomingStateVars = aa_state.getUpcomingStateVars();

	async function estimateAndSendAARequest(curve_aa, de_aa, dataPayload, positiveResponseRegexp) {
		let objUnit = utils.constructDummyObject(operator_address, de_aa, dataPayload);
		let responses = await aa_composer.estimatePrimaryAATrigger(objUnit, de_aa, upcomingStateVars, upcomingBalances);
		// ** process estimated response ** //
		if (responses[0].bounced)
			console.error('INFO: DE would bounce: ', responses[0].response.error)
		else if (responses[0].response && responses[0].response.responseVars && responses[0].response.responseVars.message) {
			let responseMessage = responses[0].response.responseVars.message;
			if (responseMessage.match(positiveResponseRegexp)) {
				await dag.sendAARequest(de_aa, dataPayload); // trigger DE
				console.error('*************************')
				let message = 'INFO: DE Triggered by ' + JSON.stringify(dataPayload) + ' for AA: ' + curve_aa + ' expected response: ' + responseMessage;
				utils.sendMessage(message, paired_bots);
				console.error('*************************')
			}
			else
				console.error('INFO: ', responseMessage, ' DE: ', de_aa, ' for Curve AA: ', curve_aa)
		}
		else
			console.error(`--- estimated responses to simulated DE AA request`, JSON.stringify(responses, null, 2));
	}

	// ** for each Curve AA estimate and trigger DE ** //
	for (let curve_aa of curve_aas_to_estimate) {		
		// ** estimate DE response ** //
		let de_aa = curve_aas[curve_aa].de_aa
		await estimateAndSendAARequest(curve_aa, de_aa, { act: 1 }, /fixed the peg/);
		await estimateAndSendAARequest(curve_aa, de_aa, { sweep_capacitor: 1 }, /Expecting to make a profit of/);
	}
	unlock();
}

process.on('unhandledRejection', up => {
	console.error('unhandledRejection event', up, up.stack);
	throw up;
});