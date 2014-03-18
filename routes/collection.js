var getCollectionId = function() {
	// Do something
};

exports.add = function(req, res) {
	console.log("[WGST] Received request for collection id");
	console.log('User assembly ids:');
	console.log(req.body.userAssemblyIds);

	var uuid = require('node-uuid'),
		userAssemblyIds = req.body.userAssemblyIds;

	// TODO: Validate request

	// Call RabbitMQ

	var amqp = require('amqp'),
		connection = amqp.createConnection({
			host: '129.31.26.152', //'129.31.26.152', //'fi--didewgstcn1.dide.local',
			port: 5670
		}, {
			reconnect: false,
			autoDelete: true
		});

	connection.on('error', function(error) {
	    console.error('✗ [WGST][ERROR] Ignoring error: ' + error);
	});

	connection.on("ready", function(){
		console.log('[WGST] Connection is ready');

		var queueId = 'ART_CREATE_COLLECTION_' + uuid.v4(),
			exchange = connection.exchange('wgst-ex', {
				type: 'direct',
				passive: true,
				durable: false,
				confirm: false,
				autoDelete: false,
				noDeclare: false,
				confirm: false
			}, function(exchange) {
				console.log('[WGST] Exchange "' + exchange.name + '" is open');
			});

		// Prepare object to publish
		var collectionRequest = {
			taskId: 'new',
			userAssemblyIds: userAssemblyIds
		};

		// Publish message
		exchange.publish('id-request', collectionRequest, { 
			mandatory: true,
			contentType: 'application/json',
			deliveryMode: 1,
			correlationId: 'Art', // Generate UUID?
			replyTo: queueId
		}, function(err){
			if (err) {
				console.log('✗ [WGST][ERROR] Error in trying to publish');
				return; // return undefined?
			}

			console.log('[WGST] Message was published');
		});

		connection
			.queue(queueId, { // Create queue
				passive: false,
				durable: false,
				exclusive: true,
				autoDelete: true,
				noDeclare: false,
				closeChannelOnUnsubscribe: false
			}, function(queue){
				console.log('[WGST] Queue "' + queue.name + '" is open');

			}) // Subscribe to response message
			.subscribe(function(message, headers, deliveryInfo){
			
				console.log('[WGST] Received response');

				var buffer = new Buffer(message.data);

				// Return result data
				res.json(buffer.toString());

				// End connection, however in reality it's being dropped before it's ended so listen for error too
				connection.end();
			});
	});
};

var getAssemblies = function(assemblyIds, callback) {
	console.log('[WGST] Getting assemblies with ids: ' + assemblyIds);

	// Prepend FP_COMP_ to each assembly id
	var scoresAssemblyIds = assemblyIds.map(function(assemblyId){
		return 'FP_COMP_' + assemblyId;
	});

	// Prepend ASSEMBLY_METADATA_ to each assembly id
	var metadataAssemblyIds = assemblyIds.map(function(assemblyId){
		return 'ASSEMBLY_METADATA_' + assemblyId;
	});

	// Prepend PAARSNP_RESULT_ to each assembly id
	var resistanceProfileAssemblyIds = assemblyIds.map(function(assemblyId){
		return 'PAARSNP_RESULT_' + assemblyId;
	});

	// Merge all assembly ids
	assemblyIds = scoresAssemblyIds
						.concat(metadataAssemblyIds)
						.concat(resistanceProfileAssemblyIds);

	console.log('[WGST] Querying keys: ');
	console.dir(assemblyIds);

	couchbaseDatabaseConnection.getMulti(assemblyIds, {}, function(err, results) {
		console.log('[WGST] Got assemblies data: ');
		console.dir(results);

		if (err) throw err;

		// Merge FP_COMP and ASSEMBLY_METADATA into one assembly object
		var assemblies = {},
			assemblyId,
			cleanAssemblyId;

		for (assemblyId in results) {
            // Parsing assembly scores
            if (assemblyId.indexOf('FP_COMP_') !== -1) {
            	cleanAssemblyId = assemblyId.replace('FP_COMP_','');
            	assemblies[cleanAssemblyId] = assemblies[cleanAssemblyId] || {};
				assemblies[cleanAssemblyId]['FP_COMP'] = results[assemblyId].value;
            // Parsing assembly metadata
            } else if (assemblyId.indexOf('ASSEMBLY_METADATA_') !== -1) {
            	cleanAssemblyId = assemblyId.replace('ASSEMBLY_METADATA_','');
            	assemblies[cleanAssemblyId] = assemblies[cleanAssemblyId] || {};
				assemblies[cleanAssemblyId]['ASSEMBLY_METADATA'] = results[assemblyId].value;
            // Parsing assembly resistance profile
            } else if (assemblyId.indexOf('PAARSNP_RESULT_') !== -1) {
            	cleanAssemblyId = assemblyId.replace('PAARSNP_RESULT_','');
            	assemblies[cleanAssemblyId] = assemblies[cleanAssemblyId] || {};
				assemblies[cleanAssemblyId]['PAARSNP_RESULT'] = results[assemblyId].value;
			}
		}

		console.log('[WGST] Assemblies with merged FP_COMP, ASSEMBLY_METADATA and PAARSNP_RESULT data: ');
		console.log(assemblies);

		callback(assemblies);
	});
};

exports.get = function(req, res) {

	var collectionId = req.body.collectionId,
		collection = {};

	console.log('[WGST] Getting collection ' + collectionId);

	// Get list of assemblies
	couchbaseDatabaseConnection.get('COLLECTION_LIST_' + collectionId, function(err, assemblyIdsData) {
		if (err) throw err;

		var assemblyIds = assemblyIdsData.value.assemblyIdentifiers;

		console.log('[WGST] Got collection ' + collectionId + ' with assembly ids:');
		console.log(assemblyIds);

		//collection.assemblyIds = assemblyIds;

		getAssemblies(assemblyIds, function(assemblies){

			collection.assemblies = assemblies;

			// Get collection tree data
			couchbaseDatabaseConnection.get('COLLECTION_TREE_' + collectionId, function(err, collectionTreeData) {

				if (err) throw err;

				var collectionTreeData = collectionTreeData.value.newickTree;

				console.log('[WGST] Got collection tree data for collection id ' + collectionId + ':');
				console.log(collectionTreeData);

				// Get collection tree metadata
				// couchbaseDatabaseConnection.get('COLLECTION_TREE_METADATA_' + collectionId, function(err, collectionTreeData) {

				// 	if (err) throw err;

				// 	var collectionTreeData = collectionTreeData.value.newickTree;

				// 	console.log('[WGST] Got collection tree data for collection id ' + collectionId + ':');
				// 	console.log(collectionTreeData);

					

				// 	collection.tree = {
				// 		data: collectionTreeData
				// 	};

				// 	res.json(collection);
				// });

				collection.tree = {
					data: collectionTreeData
				};

				res.json(collection);
			});
		});
	});
};