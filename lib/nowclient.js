var io = require('socket.io-client');

var socket = io.connect(process.argv[2]);

var closures = {};
var nowReady = false;
var lastTimeout;
var core = {};
var Proxy = {wrap: function (entity) {
  function wrapRoot(path) {
    return require('node-proxy').create({
      get : function (receiver, name) {
        var fqn = path+'.'+name;
        if (fqn == "now.core") {
          return core;
        }
        var returnObj = entity.get(fqn);
        if (returnObj && typeof returnObj === 'object') {
          return wrapRoot(fqn);
        } else {
          return returnObj;
        }
      },
      set : function (receiver, name, value) {
        var fqn = path+'.'+name;
        var val = entity.set(fqn, value);
        return wrapRoot(fqn);
      },
      enumerate : function () {
        return entity.get(path);
      },
      hasOwn : function (name) {
        return entity.scopeTable.get(path+'.'+name) !== undefined;
      },
      delete : function (name) {
        entity.deleteVar(path+'.'+name);
      },
      fix : function () {
        return undefined;
      }
    });
  }
  return wrapRoot('now');
}};

var fqnMap = {
  data: {},

  get: function (fqn) {
    return fqnMap.data[fqn];
  },

  set: function (fqn, val) {
    var lastIndex = fqn.lastIndexOf('.');
    var parent = fqn.substring(0, lastIndex);
    if (parent && !Array.isArray(fqnMap.data[parent])) {
      fqnMap.set(parent, []);
    }
    if (parent && fqnMap.data[fqn] === undefined)
      fqnMap.data[parent].push(fqn.substring(lastIndex + 1));
    if ((typeof val !== 'object' || !val) && fqn != 'now.ready') {
      var obj = {};
      obj[fqn] = util.getValOrFqn(val, fqn);
      socket.emit('rv', obj);
    }
    return fqnMap.data[fqn] = val;
  },

  deleteVar: function (fqn) {
    var lastIndex = fqn.lastIndexOf('.');
    var parent = fqn.substring(0, lastIndex);

    if (util.hasProperty(fqnMap.data, parent)) {
      // Remove from its parent.
      fqnMap.data[parent].splice(
        fqnMap.data[parent].indexOf(fqn.substring(lastIndex + 1)),
        1);
    }

    if (Array.isArray(fqnMap.data[fqn])) {
      for (var i = 0; i < fqnMap.data[fqn].length; i++) {
        // Recursive delete all children.
        fqnMap.deleteVar(fqn + '.' + fqnMap.data[fqn][i]);
      }
    }
    delete fqnMap.data[fqn];
  }
};

var util = {
  _events: {},
  // Event code from socket.io
  on: function (name, fn) {
    if (!(util.hasProperty(util._events, name))) {
      util._events[name] = [];
    }
    util._events[name].push(fn);
    return util;
  },

  emit: function (name, args) {
    if (util.hasProperty(util._events, name)) {
      var events = util._events[name].slice(0);
      for (var i = 0, ii = events.length; i < ii; i++) {
        events[i].apply(util, args === undefined ? [] : args);
      }
    }
    return util;
  },
  removeEvent: function (name, fn) {
    if (util.hasProperty(util._events, name)) {
      for (var a = 0, l = util._events[name].length; a < l; a++) {
        if (util._events[name][a] == fn) {
          util._events[name].splice(a, 1);
        }
      }
    }
    return util;
  },

  hasProperty: function (obj, prop) {
    return Object.prototype.hasOwnProperty.call(Object(obj), prop);
  },

  isArray: Array.isArray,

  createVarAtFqn: function (scope, fqn, value) {
    var path = fqn.split('.');
    var currVar = util.forceGetParentVarAtFqn(scope, fqn);
    currVar[path.pop()] = value;
  },

  forceGetParentVarAtFqn: function (scope, fqn) {
    var path = fqn.split('.');
    path.shift();

    var currVar = scope;
    while (path.length > 1) {
      var prop = path.shift();
      if (!util.hasProperty(currVar, prop)) {
        if (!isNaN(path[0])) {
          currVar[prop] = [];
        } else {
          currVar[prop] = {};
        }
      }
      currVar = currVar[prop];
    }
    return currVar;
  },

  getVarFromFqn: function (scope, fqn) {
    var path = fqn.split('.');
    path.shift();
    var currVar = scope;
    while (path.length > 0) {
      var prop = path.shift();
      if (util.hasProperty(currVar, prop)) {
        currVar = currVar[prop];
      } else {
        return false;
      }
    }
    return currVar;
  },

  generateRandomString: function () {
    return Math.random().toString().substr(2);
  },

  getValOrFqn: function(val, fqn) {
    if (typeof val === 'function') {
      if (val.remote) {
        return undefined;
      }
      return {fqn: fqn};
    } else {
      return val;
    }
  },

  watch: function (obj, label, fqn) {
    var val = obj[label];

    function getter () {
      return val;
    };
    function setter (newVal) {
      if (val !== newVal) {
        // trigger some sort of change.
        if (val && typeof val === 'object') {
          fqnMap.deleteVar(fqn);
          lib.processScope(obj, fqn.substring(0, fqn.lastIndexOf('.')));
          return undefined;
        }
        val = newVal;
        if (newVal && typeof newVal === 'object') {
          fqnMap.deleteVar(fqn);
          lib.processScope(newVal, fqn);
          return undefined;
        }
        fqnMap.set(fqn, newVal);
        if (typeof newVal === 'function') {
          newVal = {fqn: fqn};
        }
        var obj = {};
        obj[fqn] = newVal;
        socket.emit('rv', obj);
      }
      return newVal;
    };
    Object.defineProperty(obj, label, {get: getter, set: setter});
  }
};

var now = Proxy.wrap(fqnMap);


var lib = {

  deleteVar: function (fqn) {
    var path, currVar, parent, key;
    path = fqn.split('.');
    currVar = now;
    for (var i = 1; i < path.length; i++) {
      key = path[i];
      if (currVar === undefined) {
        // delete from fqnMap, just to be safe.
        fqnMap.deleteVar(fqn);
        return;
      }
      if (i === path.length - 1) {
        delete currVar[path.pop()];
        fqnMap.deleteVar(fqn);
        return;
      }
      currVar = currVar[key];
    }
  },

  replaceVar: function (data) {
    for (var fqn in data) {
      if (util.hasProperty(data[fqn], 'fqn')) {
        data[fqn] = lib.constructRemoteFunction(fqn);
      }
      util.createVarAtFqn(now, fqn, data[fqn]);
    }
  },

  remoteCall: function (data) {
    var func;
    // Retrieve the function, either from closures hash or from the now scope
    if (data.fqn.split('_')[0] === 'closure') {
      func = closures[data.fqn];
    } else {
      func = fqnMap.get(data.fqn);
    }
    var args = data.args;

    if (typeof args === 'object' && !util.isArray(args)) {
      var newargs = [];
      // Enumeration order is not defined so this might be useless,
      // but there will be cases when it works
      for (var i in args) {
        newargs.push(args[i]);
      }
      args = newargs;
    }

    // Search (only at top level) of args for functions parameters,
    // and replace with wrapper remote call function
    for (i = 0, ii = args.length; i < ii; i++) {
      if (util.hasProperty(args[i], 'fqn')) {
        args[i] = lib.constructRemoteFunction(args[i].fqn);
      }
    }
    func.apply({now: now}, args);
  },

  // Handle the ready message from the server
  serverReady: function() {
    nowReady = true;
    util.emit('ready');
  },

  constructRemoteFunction: function (fqn) {
    var remoteFn = function () {
      var args = Array.prototype.slice.call(arguments);
      for (var i = 0, ii = args.length; i < ii; i++) {
        if (typeof args[i] === 'function') {
          var closureId = 'closure_' + args[i].name + '_' + util.generateRandomString();
          closures[closureId] = args[i];
          args[i] = {fqn: closureId};
        }
      }
      socket.emit('rfc', {fqn: fqn, args: args});
    };
    remoteFn.remote = true;
    return remoteFn;
  },
  handleNewConnection: function (socket) {
    if (socket.handled) return;
    socket.handled = true;

    socket.on('rfc', function (data) {
      lib.remoteCall(data);
      util.emit('rfc', data);
    });
    socket.on('rv', function (data) {
      lib.replaceVar(data);
      util.emit('rv', data);
    });
    socket.on('del', function (data) {
      lib.deleteVar(data);
      util.emit('del', data);
    });

    // Handle the ready message from the server
    socket.on('rd', function(data){
      lib.serverReady();
    });

    socket.on('disconnect', function () {
      util.emit('disconnect');
    });
    // Forward planning for socket io 0.7
    socket.on('error', function () {
      util.emit('error');
    });
    socket.on('retry', function () {
      util.emit('retry');
    });
    socket.on('reconnect', function () {
      util.emit('reconnect');
    });
    socket.on('reconnect_failed', function () {
      util.emit('reconnect_failed');
    });
    socket.on('connect_failed', function () {
      util.emit('connect_failed');
    });
  }
};

core.socketio = socket;
socket.on('connect', function () {
  core.clientId = socket.id;
  socket.connected = true;
  lib.handleNewConnection(socket);

  socket.emit('rd');
  util.emit('connect');
});

socket.on('disconnect', function () {
  // y-combinator trick
  socket.connected = false;
  (function (y) {
    y(y, now);
  })(function (fn, obj) {
    for (var i in obj) {
      if (obj[i] && typeof obj[i] === 'object' &&
          obj[i] != document && obj[i] !== now.core) {
        fn(fn, obj[i]);
      }
      else if (typeof obj[i] === 'function' && obj[i].remote) {
        delete obj[i];
      }
    }
  });
  // Clear all sorts of stuff in preparation for reconnecting.
  fqnMap.data = {};
});

exports.now = now;
exports.socket = socket;