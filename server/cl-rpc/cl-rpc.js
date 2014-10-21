var	async       = require('async'),
	CronJob     = require('cron').CronJob,
	crypto      = require('crypto'),
	exec        = require('child_process').exec,
	fs          = require('fs'),
	libpath     = require('path'),
	mkdirp      = require('mkdirp'),
	ms          = require('ms'),
	os          = require('os'),
	prettyPrint = require('pretty-data').pd,
	winston     = require('winston'),
	_           = require('underscore');

var cacheCleaner = require('./cacheCleaner.js');

// directory where user can add their own .json action definition files
var actionsDirectories = [];

// object storing all the actions
var actions;

// permissions level (1 by default)
var permissions;

// base directory where all data files are (data, cache, actions, ..)
var filesRoot;

// allowed sub-directories in filesRoot. They are automatically created if not existent
var directories = [];
var dataDirs = {};

// variable to enumerate actions for logging
var actionsCounter = 0;

//30 days of maximum life time for cache folders
var maxAge = ms('30d');

// object stroring all currently running actions
var ongoingActions = {};

var configFiles = [];

function listen(curr, prev) {
	if ((curr.mtime > prev.mtime) || (curr.dev === 0)) {
		update(exports.onUpdate);
	}
}

function cleanCache() {
	cacheCleaner.cleanCache(libpath.join(filesRoot, 'cache'), maxAge);
}

var job = new CronJob({
	cronTime: '0 0 ' + Math.floor(24 * Math.random()) + ' * * *',
	onTick: cleanCache,
	start: true
});

exports.validatePath = function (path, callback) {
	fs.realpath(libpath.join(filesRoot, path), function (err, realPath) {
		if (!err && !_.some(directories, function (subDir) {
				return realPath.slice(0, subDir.length) === subDir;
			})) {
			err = "path " + path + " not allowed"; 
		}

		callback (err);
	});
};

function includeActionsFile (file, callback) {
	fs.exists(file, function (exists) {
		if (exists) {
			if (libpath.extname(file).toLowerCase() === '.json') {
				console.log('importing actions from : ' + file);
				includeActionsJSON(file, callback);
				return;
			}
			callback();
			return;
		}
		console.log("Warning : no file " +file + " found");
		callback();
	});
}

exports.includeActions = function (file, callback) {
	switch (typeof file) {
	case "string" :
		includeActionsFile(file, callback);
		break;
	case "object" :
		async.eachSeries(file, includeActionsFile, callback);
		break;
	default:
		callback ("error in actions importations: cannot handle " + file);
	}
};

includeActionsJSON = function (file, callback) {
	fs.watchFile(file, listen);
	configFiles.push(file);
	fs.readFile(file, function (err, data) {
		try {
			var libraryName = libpath.basename(file, '.json');
			var actionsObject = JSON.parse(data);

			var localActions = actionsObject.actions || [];
			var path = fs.realpathSync(libpath.dirname(file));
			Object.keys(localActions).forEach(function (actionName) {
				var action = localActions[actionName];
				action.lib = libraryName;
				var attributes = action.attributes;
				if ( typeof (attributes.js) === 'string' ) {
					console.log('loaded javascript from ' + attributes.js);
					attributes.executable = libpath.join(path, attributes.js + '.js');
					attributes.module = require(libpath.join(path, attributes.js));
					attributes.path = path;
				} else if ( typeof (attributes.executable) === 'string' ) {
					attributes.executable = libpath.join(path, attributes.executable);
					attributes.path = path;
				}
				var existingAction = actions[actionName];
				if (existingAction) {
					if (action.priority < existingAction.priority) {
						return;
					}
				}
				actions[actionName] = action;
			});

			var dirs = actionsObject.dataDirs || {};
			Object.keys(dirs).forEach(function (key) {
				var source = dirs[key];
				if (source.indexOf('./') === 0) {
					// source is relative, prepend directory
					source = libpath.join(libpath.dirname(file), source);
				}
				dataDirs[key] = source;
			});

			var includes = (actionsObject.include || []).map(function (include) {
				if (include.charAt(0) != '/') {
					// the path is relative. Prepend directory
					include = libpath.join(libpath.dirname(file), include);
				}
				return include;
			});

			if (typeof(actionsObject.permissions) === 'number') {
				permissions = actionsObject.permissions;
			}
		}
		catch (error) {
			console.log('error importing ' + file);
			console.log(error);
			actions['import_error_' + libraryName] = {lib : libraryName};
			if ( typeof(callback) === 'function' ) {
				callback();
			}
			exports.onUpdate();
			return;
		}
		exports.includeActions(includes, callback);
	});
};

exports.addDirectory = function (directory) {
	actionsDirectories.push(directory);
};

exports.onUpdate = function () {};

function update (callback) {
	console.log("updating actions:");
	// clear actions
	actions = {};
	dataDirs = {};
	permissions = 1;
	configFiles.forEach(function (file) {
		fs.unwatchFile(file, listen);
	});

	configFiles.length = 0;

	async.each(actionsDirectories, function (directory, callback) {
		fs.readdir(directory, function (err, files) {
			async.each(files, function(file, callback) {
				exports.includeActions(libpath.join(directory, file), callback);
			}, callback);
		});
	}, function (err) {
		console.log(Object.keys(actions).length + ' actions included');

		// create all data directories and symlinks if they do not exist
		Object.keys(dataDirs).forEach(function (key) {
			var dir = libpath.join(filesRoot, key);
			if (!fs.existsSync(dir)) {
				console.log('Warning : directory ' + dir + ' does not exist. Creating it');
				var source = dataDirs[key];
				if (source === key) {
					fs.mkdirSync(dir);
					console.log('directory ' + dir + ' created');
					directories.push(fs.realpathSync(dir));
				} else {
					if (fs.existsSync(source)) {
						fs.symlinkSync(source, dir, 'dir');
						console.log('directory ' + dir + ' created as a symlink to ' + source);
						directories.push(fs.realpathSync(dir));
					} else {
						console.log('ERROR : Cannot create directory ' + dir + ' as source directory ' + source + ' does not exist');
					}
				}
			} else {
				directories.push(fs.realpathSync(dir));
			}
		});
		cleanCache();

		// export actions.json
		fs.writeFile(libpath.join(filesRoot, "actions.json"),
			prettyPrint.json(JSON.stringify({actions : actions ,
				permissions : permissions, dataDirs : dataDirs})),
			function (err) {
				if (err) throw err;
				if (typeof callback === "function") {
					callback({});
				}
		});
	});
};

exports.getAction = function (actionName) {
	return JSON.parse(JSON.stringify(actions[actionName]));
};

exports.setRoot = function (root) {
	filesRoot = fs.realpathSync(root);
};

function validateValue (parameterValue, parameter) {
	var compare;
	if (parameter.min) {
		compare = parseFloat(parameter.min);
		if (parameterValue < compare) {
			return ('error : parameter ' + parameter.name +
				' minimum value is ' + compare);
		}
	}
	if (parameter.max) {
		compare = parseFloat(parameter.max);
		if (parameterValue > compare) {
			return ('error : parameter ' + parameter.name +
				' maximal value is ' + compare);
		}
	}
	return;
}

function manageActions (POST, callback) {
	switch (POST.manage) {
	case 'update':
		update(callback);
		return;
	case "kill" :
		var handle = ongoingActions[POST.actionHandle];
		if (!handle) {
			callback ({status : 'not found'});
			return;
		}
		if (handle.childProcess) {
			handle.childProcess.kill();
			console.log('killed process ' + handle.childProcess.pid);
			callback ({status : 'killed'});
		} else {
			callback ({status : 'not existent'});
		}
		return;
	case "list" :
	default:
		// we need to remove circular dependencies before sending the list
		var cache = [];
		var objString = JSON.stringify({ ongoingActions : ongoingActions},
			function(key, value) {
				if (typeof value === 'object' && value !== null) {
					if (cache.indexOf(value) !== -1) {
						// Circular reference found, discard key
						return;
					}
					// Store value in our collection
					cache.push(value);
				}
				return value;
			}
		);
		callback(JSON.parse(objString));
		return;
	}	
}

var queue = async.queue(function (task, callback) {
	new RPC(task, callback);
}, os.cpus().length * 2);

exports.performAction = function (POST, callback) {
	POST.handle  = POST.handle || Math.random().toString();
	if (POST.manage) {
		manageActions(POST, finished);
	} else {
		queue.push(POST, finished);
	}

	function finished(msg) {
		msg.handle = POST.handle;
		callback(msg);
	}
};

var actionsDirectoriesQueue = async.queue(function (task, callback) {
	var counterFile = libpath.join(filesRoot, "actions/counter.json");
	fs.readFile(counterFile, function (err, data) {
		var index = 1;
		if (!err) {index = JSON.parse(data).value + 1;} 

		var outputDirectory = libpath.join("actions", index + "");
		mkdirp(libpath.join(filesRoot, outputDirectory), function (err) {
			if ( err ) {
				callback( err.message );
				return;
			}
			fs.writeFile(counterFile, JSON.stringify({value : index}), 
				function(err) {
					if (err) {
						callback(err);
						return;
					}
					callback(null, outputDirectory);
				}
			);
		});
	});
}, 1);

function RPC(POST, callback) {
	actionsCounter++;

	this.POST = POST;
	this.inputMTime = -1;

	var header = "[" + actionsCounter + "] ";
	this.log = function (msg) {winston.log('info', header + msg)};

	this.response = {};
	this.action = actions[POST.action];
	this.cached = false;

	if (!this.action) {
		callback({error : "action " + POST.action + " not found"});
		return;
	};

	this.commandLine = "nice " + (this.action.attributes.executable || this.action.attributes.command);
	this.log("handle : " + this.POST.handle);

	async.series([
		this.parseParameters.bind(this),
		this.handleExecutableMTime.bind(this),
		this.handleInputMTimes.bind(this),
		this.handleOutputDirectory.bind(this),
		this.handleLogAndCache.bind(this),
		this.executeAction.bind(this)
		],
		function (err) {
			this.log("done");
			if (err) {
				this.response.status = "ERROR";
				this.response.error = err;
			}
			callback(this.response);
		}.bind(this)
	);
};

RPC.prototype.parseParameters = function (callback) {
	async.map(this.action.parameters, this.parseParameter.bind(this), function (err, params) {
		params.forEach(function (param) {
			if (typeof param === "string") {
				this.commandLine += ' '+ param;
			}
		}.bind(this));
		callback (err);
	}.bind(this));
};

RPC.prototype.parseParameter = function (parameter, callback) {

	if (parameter.text !== undefined) {
		// parameter is actually a text anchor
		callback(null, parameter.text);
		return;
	}

	var prefix = parameter.prefix || '';
	var value = this.POST[parameter.name];

	if (value === undefined) {
		if (parameter.required) {
			callback ("parameter " + parameter.name + " is required!");
		} else {
			callback();
		}
		return;
	}

	switch (parameter.type) {
	case 'file':
		fs.realpath(libpath.join(filesRoot, value), function (err, path) {
			callback (err, err ? null : prefix + path.split(" ").join("\\ "));
		});
		break;
	case 'directory':
		fs.realpath(libpath.join(filesRoot, value), function (err, path) {
			if (err) {
				callback (err);
				return;
			}
			fs.stat(libpath.join(filesRoot, value), function (err, stats) {
				if (!stats.isDirectory()) {
					callback ("error : " + value + " is not a directory");
					return;
				}
				callback (null, prefix + path.split(" ").join("\\ "));
			});
		});
		break;
	case 'string':
		if (value.indexOf(" ") === -1) {
			callback (null, prefix + value);
		} else {
			callback ("parameter " + parameter.name + " must not contain spaces");
		}
		break;
	case 'int':
		var number = parseInt(value, 10);
		if (isNaN(number)) {
			callback ("parameter " + parameter.name + " must be an integer value");
		} else {
			callback (validateValue(number, parameter), prefix + value);
		}
		break;
	case 'float':
		number = parseFloat(value, 10);
		if (isNaN(number)) {
			callback ("parameter " + parameter.name + " must be a floating point value");
		} else {
			callback (validateValue(number, parameter), prefix + value);
		}
		break;
	case 'text':
	case 'base64data':
		callback (null, prefix + value);
		break;
	default:
		callback ("parameter type not handled : " + parameter.type);
	}

};

RPC.prototype.handleExecutableMTime = function (callback) {
	this.addMTime(this.action.attributes.executable, callback);
};

RPC.prototype.addMTime = function (file, callback) {
	if (!file) {
		callback();
		return;
	}
	fs.stat(file , function (err, stats) {
		if (!err) {
			this.inputMTime = Math.max(stats.mtime.getTime(), this.inputMTime);
		}
		callback (err);
	}.bind(this));
}

RPC.prototype.handleInputMTimes = function (callback) {
	async.each(this.action.parameters, function (parameter, callback) {
		if (this.POST[parameter.name] === undefined) {
			callback();
			return;
		}
		switch (parameter.type) {
			case "file":
			case "directory" : 
				this.addMTime(libpath.join(filesRoot, this.POST[parameter.name]), callback);
				break;
			default : 
				callback();
		}
	}.bind(this),
	function (err) {
			callback(err);
		}
	);
};

RPC.prototype.handleOutputDirectory = function (callback) {
	if (permissions === 0) {this.POST.output_directory = "cache/";}

	this.response.MTime = this.inputMTime;
	this.outputDirectory = this.POST.output_directory || "";

	if (this.action.attributes.voidAction) {
		callback();
		return;
	}

	switch (this.outputDirectory) {
	case "actions/" :
		actionsDirectoriesQueue.push({}, function (err, dir) {
			this.outputDirectory = dir;
			callback(err);
		}.bind(this));
		break;
	case "cache/" :
	case "" : 
		var shasum = crypto.createHash('sha1');
		shasum.update(this.commandLine);
		var hash = shasum.digest('hex');
		this.outputDirectory = libpath.join("cache", hash.charAt(0), hash.charAt(1), hash);
		mkdirp(libpath.join(filesRoot, this.outputDirectory), callback);
		break;
	default :
		exports.validatePath (libpath.normalize(this.outputDirectory).split("/")[0], function (err) {
			if (err) {
				callback(err);
				return;
			}
			mkdirp(libpath.join(filesRoot, this.outputDirectory), callback);
		}.bind(this));
	}
};

RPC.prototype.handleLogAndCache = function (callback) {
	this.outputDirectory = libpath.normalize(this.outputDirectory);
	if (this.outputDirectory.charAt(this.outputDirectory.length -1) !== "/") {
		this.outputDirectory += "/";
	}

	this.response.outputDirectory = this.outputDirectory;

	var params = {action : this.POST.action, output_directory :  this.outputDirectory};
	this.action.parameters.forEach(function (parameter) {
		params[parameter.name] = this.POST[parameter.name];
	}, this);
	this.parametersString = JSON.stringify(params);

	this.log ('in : ' + this.outputDirectory);

	if (this.commandLine.length < 500) {
		this.log(this.commandLine);
	} else {
		this.log(this.commandLine.substr(0,500) + '...[trimmed]');
	}

	if (this.action.attributes.voidAction || this.POST.force_update ||
		this.action.attributes.noCache) {
			callback();
			return;
	}

	// check if action was already performed
	var actionFile = libpath.join(filesRoot, this.outputDirectory, "action.json");
	fs.stat(actionFile, function (err, stats) {
		if ((err) || (stats.mtime.getTime() < this.inputMTime)) {
			callback();
			return;
		}
		fs.readFile(actionFile, function (err, data) {
			if (data == this.parametersString) {
				this.log("cached");
				this.cached = true;
			} 
			callback();
		}.bind(this));
	}.bind(this));

};

RPC.prototype.executeAction = function (callback) {
	if (this.cached) {
		this.cacheAction(callback);
		return;
	}

	this.startTime = new Date().getTime();
	this.writeJSON = false;

	var commandOptions = {cwd: libpath.join(filesRoot, this.outputDirectory), maxBuffer : 1e10};

	if (!this.action.attributes.voidAction) {
		this.writeJSON = true;
	}

	var after = function (err, stdout, stderr) {
		this.afterExecution(err, stdout, stderr, callback);			
	}.bind(this);

	var js = this.action.attributes.module;
	if ( typeof (js) === "object" ) {
		var actionParameters2 = JSON.parse(this.parametersString);
		actionParameters2.filesRoot = filesRoot;
		actionParameters2.HackActionsHandler = exports;
		js.execute(actionParameters2, after);
		return;
	}

	var handle = {POST : JSON.parse(JSON.stringify(this.POST))};

	var child = handle.childProcess = exec(this.commandLine, commandOptions, after);
	ongoingActions[this.POST.handle] = handle;

	if (this.outputDirectory) {
		this.logStream = fs.createWriteStream(libpath.join(filesRoot, this.outputDirectory, "action.log"));
		this.logStream2 = fs.createWriteStream(libpath.join(filesRoot, this.outputDirectory, "action.err"));
		child.stdout.pipe(this.logStream);
		child.stderr.pipe(this.logStream2);
	}
};

RPC.prototype.cacheAction = function (callback) {
	this.response.status = 'CACHED';
	var now = new Date();

	async.parallel([

		function (callback) {
			fs.utimes(libpath.join(filesRoot, this.outputDirectory, "action.json"), now, now, callback);
		}.bind(this),

		function (callback) {
			fs.utimes(libpath.join(filesRoot, this.outputDirectory), now, now, callback);
		}.bind(this),

		function (callback) {
			if (this.POST.stdout) {
				async.parallel([function (callback) {
						fs.readFile(libpath.join(filesRoot, this.outputDirectory, 'action.log'),
							function (err, content) {
								if (content) this.response.stdout = content.toString();
								callback();
						}.bind(this));
					}.bind(this),
					function (callback) {
						fs.readFile(libpath.join(filesRoot,this. outputDirectory, 'action.err'),
							function (err, content) {
								if (content) this.response.stderr = content.toString();
								callback();
						}.bind(this));
					}.bind(this)],
				callback);
			} else {
				this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';
				callback();
			}
		}.bind(this)
	], callback);
};

RPC.prototype.afterExecution = function(err, stdout, stderr, callback) {
	if (this.logStream) {
		this.logStream.end();
		this.logStream2.end();
	}

	if (this.POST.stdout) {
		this.response.stdout = stdout;
		this.response.stderr = stderr;
	} else {
		this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';
	}

	delete ongoingActions[this.POST.handle];

	if (err) {
		if (err.killed) {
			this.response.status = "KILLED";
			callback();
		} else {
			callback(err);
		}
	} else {
		this.response.status = 'OK (' + (new Date().getTime() - this.startTime) / 1000 + 's)';
		if (!this.writeJSON) {
			callback();
			return;
		}
		// touch output Directory to avoid automatic deletion
		var now = new Date();
		fs.utimes(libpath.join(filesRoot, this.outputDirectory), now, now);

		fs.writeFile(libpath.join(filesRoot, this.outputDirectory, "action.json"),
			this.parametersString, function (err) {
			if (err) {throw err;}
			callback();
		}.bind(this));
	}
}

exports.getDirectoryContent = function (path, callback) {
	winston.log('info', 'listDir : ' + path)
	async.waterfall([
		function (callback) {
			exports.validatePath(path, callback);
		},

		function (callback) {
			var realDir = libpath.join(filesRoot, path);
			fs.readdir(realDir, function (err, files) {
				if (err) {
					callback (err);
					return;
				}

				async.map(files, function (file, callback) {
						fs.stat(libpath.join(realDir, file), function (err, stats) {
							callback(null, {name : file, size : stats.size,
								isDirectory : stats.isDirectory(),
								mtime : stats.mtime.getTime()}
							);
						});
					},
					callback
				);
			});
		}],
		function (error, files) {
			callback(files);
		}
	);
};
exports.addDirectory(libpath.join(__dirname,'lib'));
