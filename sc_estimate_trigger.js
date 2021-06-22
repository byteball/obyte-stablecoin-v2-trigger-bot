'use strict';
const dag = require('aabot/dag.js');
const aa_state = require('aabot/aa_state.js');
const operator = require('aabot/operator.js');
const aa_composer = require("ocore/aa_composer.js");
// ** Utils and other modules ** //
const oracle_utils = require('./sc_oracle_utils.js');


// ** estimate p2 and target_p2 ** //
async function p2 (curve_aa, stable_aas) {
	const aa_unlock = await aa_state.lock();

	// ** start following Curve AA ** //
	await aa_state.followAA(curve_aa);

	// ** get Stable Fund AA & DE AA ** //
	const fund_aa = await dag.readAAStateVar(curve_aa, 'fund_aa'); 
	const de_aa = await dag.readAAStateVar(curve_aa, 'decision_engine_aa');
	
	// ** start following Fund AA and DE AA ** //
	await aa_state.followAA(fund_aa);  // follow fund AA
	await aa_state.followAA(de_aa);  // follow DE AA
	/// ??? follow vars.governance_aa ??? ///

	// ** start following Stable AAs ** //
	if ( stable_aas[curve_aa] ) {
		let stable_aas_array = Object.keys( stable_aas[curve_aa] );
		for await (let stable_aa of stable_aas_array) {
			await aa_state.followAA(stable_aa);  // follow stable AA
		}
	}

	// ** get curve_aa params & update data feeds used by it ** //
	const params = await dag.readAAParams(curve_aa);  // aa params
	await oracle_utils.updateDataFeeds(params)

	// ** get upcomming state balances and state vars for all aas ** //
	let upcomingBalances = await aa_state.getUpcomingBalances();
	let upcomingStateVars = await aa_state.getUpcomingStateVars();

	// ** construct dummy trigger unit ** //
	let objUnit = {
		unit: 'dummy_trigger_unit',
		authors: [{ address: operator.getAddress() }],
		messages: [
			{	app: 'payment',
				payload: { outputs: [{ address: de_aa, amount: 1e4 }] } 	},
			{	app: 'data',
				payload: { act: 1 } 	}
		]
	};

	// ** estimate DE response ** //
	let responses = await aa_composer.estimatePrimaryAATrigger(objUnit, de_aa, 
		upcomingStateVars, upcomingBalances);
	console.log(`--- estimated responses to simulated DE AA request`, JSON.stringify(responses, null, 2));
	aa_unlock();

	if (responses[0].bounced) {
		console.error('INFO: DE would bounce: ', responses[0].response.error)
		return { status: 'DE would bounce' }
	}
	else if (responses[0].response && responses[0].response.responseVars) {
		if (responses[0].response.responseVars.message === "DE fixed the peg"  || 
			responses[0].response.responseVars.message === "DE partially fixed the peg") {
			console.error('******** about to trigger DE: ', de_aa)
			await dag.sendAARequest(de_aa, {act: 1}); // trigger DE
			return {status: 'DE Triggered'}
		}
		else if (responses[0].response.responseVars.message === "DE does not interfere yet") {
			console.error('INFO: DE would not interfere: ', responses[0].response.responseVars.message)
			return { status: 'DE would not interfere' }
		}
		else return { status: 'DE would not run' }
	}
	else return { status: 'DE would not run' }
}

exports.p2 = p2;