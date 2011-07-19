var nowclient = require('./nowclient.js');
var now = nowclient.now;
var socket = nowclient.socket;

now.receiveMessage = function (message) {
  console.log(message);
};
