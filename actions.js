var fs = require('fs'),
	libpath = require('path'),
	async = require('async'),
	crypto = require('crypto'),
	exec = require('child_process').exec,
	prettyPrint = require('pretty-data').pd;

var actionsDir="actions/";
	
var filesRoot;
var actions=[];

var actionsRoot,cacheRoot,dataRoot;

function validatePath(path, callback) {
	fs.realpath(filesRoot+path, function (err, realPath) {
		if (err) {
			callback(err.message);
			return;
		}
		else {
			if (realPath.slice(0, actionsRoot.length) == actionsRoot) {
				callback (null);
				return;
			}
			if (realPath.slice(0, cacheRoot.length) == cacheRoot) {
				callback (null);
				return;
			}
			if (realPath.slice(0, dataRoot.length) == dataRoot) {
				callback (null);
				return;
			}
			callback("path "+realPath+" not allowed");
		}
	});
}

function includeActionsFile (file, callback) {
	libpath.exists(file, function (exists) {
		if (exists) {
			switch (libpath.extname(file).toLowerCase()) {
			case ".json":
				includeActionsJSON(file, afterImport);
				break;
			default:
		//		console.log("*: "+file+": format not handled");
				callback(null);
			}

			function afterImport (data) {
				actions=actions.concat(data)
				console.log(data.length+'/'+actions.length+' actions from '+file);
				callback(null);
			}
		}
		else {
			console.log("Warning : no file "+file+" found");
			callback(null);
		}
	});
}

exports.includeActions=function (file, callback) {
	switch (typeof (file))
	{
	case "string" :
		includeActionsFile(file, afterImport);
		break;
	case "object" :
		async.forEachSeries(file, includeActionsFile, afterImport);
		break;
	default:
		callback ("error in actions importations: cannot handle "+file);
		afterImport();
	}

	function afterImport() {
		exportActions( filesRoot+"/actions.json", callback );
	}
}

includeActionsJSON= function (file, callback) {
	fs.readFile(file, function (err, data) {
		var actionsObject=JSON.parse(data);
		var localActions=actionsObject.actions || [];

		var path=fs.realpathSync(libpath.dirname(file));
		for (var i=0; i<localActions.length;i++) {
			var attributes=localActions[i].attributes;
			if ( typeof (attributes.js) === "string" ) {
				console.log("loaded javascript from "+attributes.js);
				attributes.js=require(path+"/"+attributes.js);
			}
			if ( typeof (attributes.executable) === "string" ) {
				attributes.executable=path+"/"+attributes.executable;
			}
			if ( typeof (attributes.command) === "string" ) {
				attributes.executable=attributes.command;
			}
		}
		var includes=actionsObject.include || [];
		exports.includeActions( includes, function () {
			if ( typeof(callback) === "function" ) {
				callback(localActions);
			}
		});
	});
}

function exportActions( file, callback ) {
//	console.log("saving actions.json to "+file);
	fs.writeFile(file, prettyPrint.json(JSON.stringify({ actions : actions , permissions : 1})),
		function (err) {
			if (err) throw err;
			if (typeof callback === "function") {
				callback();
			}
	});
}

exports.setupActions=function (root, callback) {
	filesRoot=fs.realpathSync(root)+"/";
	dataRoot=fs.realpathSync(root+"data/");
	cacheRoot=fs.realpathSync(root+"cache/");
	actionsRoot=fs.realpathSync(root+"actions/");

	fs.readdir(actionsDir, function (err, files) {
		for (var i=0;i<files.length;i++) {
			files[i]=actionsDir+files[i];
		}
		exports.includeActions(files, callback);
	});
};

exports.performAction= function (POST, callback) {

	var action;
	var commandLine="ulimit -v 12000000; nice ";

	var inputMTime=-1;

	var actionParameters={};

	function parseParameters (callback) {
		var i;
		var actionName=POST.action;
		actionParameters.action=actionName;

		for (i=0;i<actions.length;i++) {
			action=actions[i];
			if (action.name==actionName) {
				break;
			}
		}

		if (i>=actions.length) {
			callback("action "+actionName+" not found");
			return;
		}

		commandLine+=action.attributes.executable+" ";

		function parseParameter (parameter, callback) {
			if (parameter.text!==undefined) {
				// parameter is actually a text anchor
				commandLine+=parameter.text;
				callback (null);
				return;
			}
			else {
				var parameterValue=POST[parameter.name];

				actionParameters[parameter.name]=parameterValue;

				if (parameterValue===undefined){
					if (parameter.required==="true") {
						callback ("parameter "+parameter.name+" is required!");
						return;
					} else {
						callback(null);
						return;
					}
				}
				else {
				if (parameter.prefix!==undefined) {
							commandLine+=parameter.prefix;
						}
					switch (parameter.type)
					{
					case 'file':
						fs.realpath(filesRoot+parameterValue, function (err, path) {
							if (err) {
								callback (err);
								return;
							}
							commandLine+=path+" ";
							fs.stat(filesRoot+parameterValue, function (err, stats) {
								var time=stats.mtime.getTime();
								if (time>inputMTime) {
									inputMTime=time;
								}
								callback (null);
							});
						});
						break;
					case 'string':
					case 'int':
					case 'text':
					case 'float':
					case 'base64data':
						commandLine+=parameterValue+" ";
						callback (null);
						break;
					default:
						callback ("parameter type not handled : "+parameter.type);
					}
				}
			}
		}

		var parameters=action.parameters;

		async.forEachSeries(parameters, parseParameter, function(err){
			callback (err);
		});
	}


	parseParameters( function (err) {
		if (err) {
			callback (err.message);
		}

		var outputDirectory;
		var cachedAction=false;

		function handleOutputDirectory(callback) {

			outputDirectory=POST.output_directory;
			actionParameters.output_directory=outputDirectory;

			if (action.attributes.voidAction==="true") {
				callback(null);
				return;
			}

			switch (outputDirectory) 
			{
			case undefined :
			// TODO create actions directory
				var counterFile=filesRoot+"/actions/counter.json";
				fs.readFile( counterFile , function (err, data) {
					var index=1;
					if (!err) {
						index=JSON.parse(data).value + 1;
					}
					outputDirectory="actions/"+index+"/";
					fs.mkdir(filesRoot+"/actions/"+index, function (err) {
						if ( err ) {
							callback( err.message );
						}
						else {
							fs.writeFile(counterFile, JSON.stringify({value : index}), 
								function(err) {
									if (err) {
										callback( err );
									}
									else {
										callback( null );
									}
								}
							);
						}
					});
				});
				break;
			case "cache/" :
				var shasum = crypto.createHash('sha1');
				shasum.update(commandLine);
				outputDirectory="cache/"+shasum.digest('hex')+"/";
				fs.stat(filesRoot+outputDirectory, function (err, stats) {
					if (err) {
						// directory does not exist, create it
						fs.mkdir(filesRoot+outputDirectory,0777 , function (err) {
							if (err) {
								callback(err.message);
							}
							else {
								callback (null);
							}
						});
						return;
					}
					else {
						callback (null);
					}
				})
				break;
			default :
				validatePath ( outputDirectory, callback );
			}
		}

		function executeAction (callback) {
			var startTime=new Date().getTime();

			var js=action.attributes.js;
			if ( typeof (js) === "object" ) {
				var actionParameters2 = JSON.parse(JSON.stringify(actionParameters));
				actionParameters2.filesRoot=filesRoot;
				js.execute(actionParameters2, afterExecution);
				return;
			}

			var commandOptions={ cwd:filesRoot };
			if ((action.attributes.voidAction !=="true") || (action.name=="add_subdirectory")) {
				commandOptions.cwd+=outputDirectory;
			}
			console.log ("in : "+outputDirectory);
			console.log(commandLine);
			exec(commandLine+" | tee action.log", commandOptions, afterExecution);

			function afterExecution(err, stdout, stderr) {
				if (err) {
					callback (err.message);
				}
				else {
					var string=JSON.stringify(actionParameters);
					fs.writeFile(filesRoot+outputDirectory+"/action.json", string, function (err) {
						if (err) throw err;
						callback (outputDirectory+"\n"+stdout+"\nOK ("+(new Date().getTime()-startTime)/1000+"s)\n");
					});
				}
			}

		}

		handleOutputDirectory(function (err) {
			if (err) {
				callback (err);
				return;
			}

			actionParameters.output_directory=outputDirectory;

			if ((action.attributes.voidAction==="true")||(POST.force_update==="true")){
				executeAction(callback);
			}
			else {
				// check if action was already performed
				var actionFile=filesRoot+outputDirectory+"/action.json";
				fs.stat(actionFile, function (err, stats) {
					if ((err)||(stats.mtime.getTime()<inputMTime)) {
						executeAction(callback);
					}
					else {
						fs.readFile(actionFile, function (err, data) {
							if (data==JSON.stringify(actionParameters)) {
						  		console.log("cached");
						  		fs.readFile(filesRoot+outputDirectory+"/action.log", function (err, string) {
								//	if (err) throw err;
									callback (outputDirectory+"\n"+string+"\nCACHED\n")
								});
							}
							else {
								executeAction(callback);
							}
						});
				  	}
				});
			}
		})
	});
}
