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
	if (conf.exclude_curve_aas) {
		for await ( let exclude_aa of conf.exclude_curve_aas ) {
			if ( curve_aa === exclude_aa ) return false;
		}
	}
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
	/// ??? follow vars.governance_aa ??? ///
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
	// ** user sends message to the bot ** //
	eventBus.on('text', (from_address, text) => { 
		bot_utils.respond(from_address, text, operator_address) // respond to user message
	});
	
	await operator.start(); // start the built-in wallet
	network.start();  	// start network
	operator_address = operator.getAddress();  // get operator's address
	
	console.error('************ START WATCHING ************')
	console.error('*** Operator: ', operator_address, ' ***')
	
	// ** check for mandatory config params ** //
	if (!conf.base_aas || !conf.factory_aas) {
		console.error('Error: missing mandatory parameters from the config. Process terminated.')
		process.exit(1)
	}

	// ** get all Curve AAs and start following them and all associated AAs ** //
	const curve_aas_array = await dag.getAAsByBaseAAs(conf.base_aas);  // get curve AAs
	for await (let aa of curve_aas_array) {
		await addNewCurveAA(aa.address)
	}
	
	// ** get all stable AAs and start following them ** //
	for await (let factory_aa of conf.factory_aas) {
		let factory_aa_vars = await dag.readAAStateVars(factory_aa, "stable_aa_");
		let stable_aas = Object.keys(factory_aa_vars);
		for await (let stable_aa of stable_aas) {
			stable_aa = stable_aa.replace('stable_aa_','');
			await aa_state.followAA(stable_aa);  // follow DE AA	
		}		
	}

	eventBus.on('data_feeds_updated', estimateAndTrigger);

	let interval = 60 * 10 //  set interval, e.g. to 10 minutes
	if (conf.interval) interval = conf.interval
	///setInterval( () => estimateAndTrigger(), interval * 1000);
	setInterval( () => checkDataFeeds(), interval * 1000);
})

// ** check Data Feeds ** //
async function checkDataFeeds() {
	console.error('------------>>>>')
	// ** check for new AAs ** //
	const curve_aas_array = await dag.getAAsByBaseAAs(conf.base_aas);  // get curve AAs
	for await (let aa of curve_aas_array) {
		if (!curve_aas[aa.address]) await addNewCurveAA(aa.address)
	}
	// ** update data feeds ** //
	let updated_data_feed = false
	let oracles_array = Object.keys(oracles);
	for await (let oracle of oracles_array) {
		let data_feeds_array = Object.keys(oracles[oracle]);
		for await (let data_feed of data_feeds_array) {
			if (conf.bLight) {
				let updated = await light_data_feeds.updateDataFeed(oracle, data_feed, true);
				if (updated) {
					console.error('INFO: updated Data Feed: ',  data_feed, ' from Oracle: ', oracle)
					updated_data_feed = true 
					/// ??? it could be better to call the estimateAndTrigger function 
					/// here for AAs affected by the change in the Data Feed
					/// rather than estimating all AAs
				}
			}
		}
	}
	if (updated_data_feed) eventBus.emit('data_feeds_updated');
	else console.error('INFO: no change in Data Feeds') 
}

// ** estiamte and trigger ** //
async function estimateAndTrigger() {
	console.error('estimate and trigger function')
	const unlock = await aa_state.lock();
	// ** get upcomming state balances and state vars for all aas ** //
	let upcomingBalances = await aa_state.getUpcomingBalances();
	let upcomingStateVars = await aa_state.getUpcomingStateVars();
	
	// ** for each Curve AA estimate and trigger DE ** //
	let curve_aas_array = Object.keys(curve_aas);
	for await (let curve_aa of curve_aas_array) {
		let de_aa = curve_aas[curve_aa].de_aa
		// ** construct dummy trigger unit ** //
		let objUnit = await utils.constructDummyObject( operator_address, de_aa)
		// ** estimate DE response ** //
		let responses = await aa_composer.estimatePrimaryAATrigger(objUnit, de_aa, 
			upcomingStateVars, upcomingBalances);
		// ** process estimated response ** //
		if (responses[0].bounced) console.error('INFO: DE would bounce: ', responses[0].response.error)
		else if (responses[0].response && responses[0].response.responseVars && responses[0].response.responseVars.message) {
			let response = responses[0].response.responseVars.message;
			if (response === "DE fixed the peg"  || response === "DE partially fixed the peg") {
				console.error('******** about to trigger DE: ', de_aa, ' for Curve AA: ', curve_aa)
				await dag.sendAARequest(de_aa, {act: 1}); // trigger DE
				let message = 'INFO: DE Triggered for AA:' + curve_aa
				await utils.sendMessage(message, paired_bots);
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