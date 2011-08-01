var nowclient = require('nowclient');
var now = nowclient.now;
var socket = nowclient.socket;

now.ready(function () {
  now.receiveMessage = function (name, message) {
    console.log(name, ':', message);
  };
});
