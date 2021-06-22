'use strict';
const conf = require('ocore/conf');
const light_data_feeds = conf.bLight ? require('aabot/light_data_feeds.js') : null;

// ** update oracle data feed ** //
async function updateDataFeed (oracle, feed_name) {
	if (conf.bLight) {
		let updated = await light_data_feeds.updateDataFeed(oracle, feed_name, true);
		if (updated) console.error('INFO: Data feed: ',  feed_name, ' from Oracle: ', oracle, ' updated.' )
	}
	return
}

// ** update oracle data feeds ** //
async function updateDataFeeds (params) {
	if (!params) return

	// ** update 1st data feed ** //
	if (params.oracle1 && params.feed_name1) await updateDataFeed(params.oracle1, params.feed_name1);

	// ** update 2nd data feed ** //
	if (params.oracle2 && params.feed_name2) await updateDataFeed(params.oracle2, params.feed_name2);

	// ** update 3rd data feed ** //
	if (params.oracle3 && params.feed_name3) await updateDataFeed(params.oracle3, params.feed_name3);

	return
}

exports.updateDataFeeds = updateDataFeeds;