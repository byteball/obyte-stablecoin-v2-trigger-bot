/*jslint node: true */
'use strict';
const conf = require('ocore/conf');
const eventBus = require('ocore/event_bus');
const network = require('ocore/network.js');
const operator = require('aabot/operator.js');
const dag = require('aabot/dag.js');
// ** Utils and other modules ** //
const bot_utils = require('./sc_bot_utils.js');
const aa_utils = require('./sc_aa_utils.js');
const estimateAndTrigger = require('./sc_estimate_trigger.js');
///const headlessWallet = require('headless-obyte');
// ** Vars ** //
let operator_address = null;
///let stable_aas = {};
let paired_bots = [];
let process_running = false;

// ** when headless wallet is ready, start network and set interval for data feeds check ** //
eventBus.once('headless_wallet_ready', async () => {
	///headlessWallet.setupChatEventHandlers();
	// ** user pairs his device with the bot ** //
	eventBus.on('paired', (from_address, pairing_secret) => {
		paired_bots.push(from_address) // store user address in an array of paired_bots
		bot_utils.paired(from_address) // send a greeting messages & check config params
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
	if (!conf.base_aas) {
		console.error('Error: base_aas parameter is missing from the conig. Process terminated.')
		process.exit(1)
	}
	if (!conf.factory_aas) {
		console.error('Error: factory_aas parameter is missing from the conig. Process terminated.')
		process.exit(1)
	}

	let interval = 60 //  set interval, e.g. to 60 sec
	if (conf.interval) interval = conf.interval
	setInterval( () => estimateP2(), interval * 1000);
})

// ** estiamte p2 ** //
async function estimateP2() {
	if (process_running) return;
	process_running = true

	console.error('------------')
	const stable_aas = await aa_utils.getStableAAs(); // populate stable_aas object
	const curve_aas = await dag.getAAsByBaseAAs(conf.base_aas);  // get curve AAs

	for await (let aa of curve_aas) {
		let curve_aa = aa.address
		let estimate = true;
		if (conf.exclude_curve_aas) {
			for await ( let exclude_aa of conf.exclude_curve_aas ) {
				if ( exclude_aa === curve_aa ) {
					estimate = false
					break	// break out of this loop
				}
			}
		}
		if (estimate) {
			let deTriggered = await estimateAndTrigger.p2(curve_aa, stable_aas);  // estimate p2 

			if (deTriggered) {
				if (deTriggered.status === 'DE Triggered') {
					let message = 'INFO: DE Triggered for AA:' + curve_aa
					await bot_utils.sendMessage(message, paired_bots);
				}
			}
			//else console.error('INFO: Missing Params / Vars data for AA:' + curve_aa)
		}
	}

	process_running = false
}

process.on('unhandledRejection', up => {
	console.error('unhandledRejection event', up, up.stack);
	throw up;
});