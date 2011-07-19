var nowclient = require('./clusterclient.js');
var now = nowclient.now;
var socket = nowclient.socket;
var interval;
var total = 0, count = 0, sent = 0, startTime;
setTimeout(function () {
  var outbound = 0, lastCount = 0;
  var a, b;
  now.receiveMessage = function (message) {
    if (count == 10000) {
      console.log(total/count);
      now.receiveMessage = function () {};
      clearInterval(a);
      clearInterval(b);
      return;
    }
    ++count;
    total += Date.now() - message;
  };
  now.start = function (interval) {
    count = 0;
    a = setInterval(function () {
      outbound++;
      now.distributeMessage(Date.now());
    }, interval);
    b = setInterval(function () {
      console.log(outbound, -lastCount + (lastCount = count));
      outbound = 0;
    }, 1000);
  };
}, 1000);