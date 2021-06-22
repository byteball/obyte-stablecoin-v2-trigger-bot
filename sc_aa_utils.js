'use strict';
const conf = require('ocore/conf');
const dag = require('aabot/dag.js');

// ** get stable aas ** //
async function getStableAAs () {
	let stable_aas = {}

	for await (let factory_aa of conf.factory_aas) {
		let factory_aa_vars = await dag.readAAStateVars(factory_aa, "stable_aa_");
		// populate stable_aas object containing curve_aa objects which conatin 1 or more stable_aa object
		let keys_array = Object.keys(factory_aa_vars);
		for await (let key of keys_array) {
			let stable_aa = factory_aa_vars[key]
			let curve_aa = key.replace('stable_aa_','');			
			if (!stable_aas[curve_aa]) {
				stable_aas[curve_aa] = {}
				stable_aas[curve_aa][stable_aa] = {curve_aa: curve_aa, stable_aa: stable_aa} 
			}
			else if (!stable_aas[curve_aa][stable_aa]) {
				stable_aas[curve_aa][stable_aa] = {curve_aa: curve_aa, stable_aa: stable_aa}
			}
		}
	}
	return stable_aas
}

exports.getStableAAs = getStableAAs;