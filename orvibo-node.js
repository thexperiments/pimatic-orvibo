// Node client for communication with Orvibo devices

var PORT = 10000;
var LOCAL_IP = '0.0.0.0';
var BROADCAST_IP = '255.255.255.255';
var TIMEOUT = 10000;

var MAGIC_CODE = '6864';
var DUMMY_SIZE = '0000';
var COMMAND_DISCOVER = '7161';
var COMMAND_SUBSCRIBE = '636c';
var COMMAND_CHANGEPOWERSTATE = '6463';
var COMMAND_CHANGEPOWERSTATE_REPLY = '7366';

var LEVEL_ERROR = 0;
var LEVEL_INFO = 1;
var LEVEL_DEBUG = 2;
var LEVEL_TRACE = 3;
var LEVEL_CURRENT = LEVEL_ERROR;


var dgram = require('dgram');
var dns = require('dns');
var os = require('os');
var e = require('events');
var util = require('util');
var promise = require ('bluebird');

//sockets 

var server = dgram.createSocket('udp4');

var self;

//server helpers

function parseMessage(message, remote){
  var messageHexString = message.toString('hex');
  var magicCode = messageHexString.substr(0,4);
  if (magicCode == MAGIC_CODE){
    //magic code matches, message seems to come from orvibo device
    msgRealLength = createHexLengthString(message.length);
    msgLength = messageHexString.substr(4,4);
    if (msgLength == msgRealLength){
      //extract ip from remote object
      messageIp = remote.address;
      _l('Message Ip:' + messageIp ,LEVEL_TRACE);
      //extract the command that triggered the answer
      messageCommand = messageHexString.substr(8,4);
      _l('Message command:' + messageCommand ,LEVEL_TRACE);
      //extract the mac from the reply, ignore the padded 0x20s
      messageMac = messageHexString.substr(12,12);
      _l('Message Mac:' + messageMac ,LEVEL_TRACE);

      //do further extraction based on command
      switch (messageCommand){
        case COMMAND_DISCOVER:
          //was an answer to a discover
          messageDeviceIdentifier = messageHexString.substr(62,12);
          messageDeviceIdentifierASCII = hexStringToAsciiString(messageDeviceIdentifier);
          _l('Message device identifier:' + messageDeviceIdentifierASCII, LEVEL_TRACE);
          if (messageDeviceIdentifierASCII.indexOf('SOC') != -1){
            //we discovered a socket so we can extract the powerstate
            messagePowerState = powerStateHexStringToBoolean(messageHexString.substr(82,2));
            _l('Message power state:' + messagePowerState.toString(), LEVEL_TRACE);
          }
          if (messageDeviceIdentifierASCII.indexOf('IR') != -1){
            //we discovered a alone so we can extract the powerstate
            
          }
          //emit event for new discovery
          _l('emitting deviceDiscovered:' + messageCommand ,LEVEL_TRACE);
          self.emit('deviceDiscovered', messageIp, messageMac, messageDeviceIdentifierASCII);
          break;
        case COMMAND_SUBSCRIBE:
          //try to extract powerstate
          messagePowerState = powerStateHexStringToBoolean(messageHexString.substr(46,2));
          _l('Message power state:' + messagePowerState.toString(), LEVEL_TRACE);
          //was an answer to subscribe
          _l('emitting subscribeSuccessful:' + messageCommand,LEVEL_TRACE);
          self.emit('subscribeSuccessful', messageIp, messageMac, messagePowerState);
          break;
        case COMMAND_CHANGEPOWERSTATE_REPLY:
          //was answer to change powerstate
          messagePowerState = powerStateHexStringToBoolean(messageHexString.substr(44,2));
          _l('Message power state:' + messagePowerState.toString(), LEVEL_TRACE);
          _l('emitting changePowerStateSuccessful:' + messageCommand ,LEVEL_TRACE);
          self.emit('changePowerStateSuccessful', messageIp, messageMac, messagePowerState);
          break;
      }

    }
    else{
      _l('message length mismatch. Real length:' + msgRealLength 
                             + ' Stated length:' + msgLength, LEVEL_ERROR);
    }
  }
  else{
    _l('magic code (' + MAGIC_CODE + ') not discovered. Code:' + magicCode, LEVEL_ERROR);
  }
}

var sendBuffer = function(ip, buffer, callback){
  server.send(buffer, 0, buffer.length, PORT, ip, function(err, bytes){
    if (err) throw err;
    _l('UDP message sent to ' + ip +':'+ PORT, LEVEL_DEBUG);
  })
}

function createDiscoveryBuffer(){
  _l('createDiscoveryBuffer',LEVEL_TRACE);
  var hexBuffer = MAGIC_CODE 
                + DUMMY_SIZE 
                + COMMAND_DISCOVER;
  return createBuffer(hexBuffer);
}

function createSubscribeBuffer(mac, password){
  _l('createSubscribeBuffer',LEVEL_TRACE);
  var hexBuffer = MAGIC_CODE 
                + DUMMY_SIZE 
                + COMMAND_SUBSCRIBE 
                + createMacHexString(mac, true);
  return createBuffer(hexBuffer);
}

function createPowerStateBuffer(mac, powerState, password){
  _l('createPowerStateBuffer',LEVEL_TRACE);
  var hexBuffer = MAGIC_CODE 
                + DUMMY_SIZE 
                + COMMAND_CHANGEPOWERSTATE 
                + createMacHexString(mac)
                + createPowerStateHexString(powerState);
  return createBuffer(hexBuffer);
}

function createBuffer (bufferHexString){
  var retBuffer = new Buffer(bufferHexString, 'hex');
  retBuffer = patchBufferLength(retBuffer);
  _l("Created buffer:" + retBuffer.toString('hex'),LEVEL_TRACE)
  return retBuffer;
}

function patchBufferLength(buffer){
  _l('patchBufferLength',LEVEL_TRACE);
  bufferSizeHexString = createHexLengthString(buffer.length);
  _l('Buffer size:' + bufferSizeHexString,LEVEL_TRACE);
  if (bufferSizeHexString.length <= 2){
    //size not exceeding one byte, we need padding
    bufferSizeHexString = '00' + bufferSizeHexString;
  }
  buffer.write(bufferSizeHexString, 2, 4, 'hex');
  return buffer;
}

function createMacHexString(mac, isSubscribe){
  _l("createMacHexString",LEVEL_TRACE);
  var retHexMacString = mac;

  if (isSubscribe === undefined) {
      isSubscribe = false;
  }

  //fill with padding
  while (retHexMacString.length < 24){
    retHexMacString = retHexMacString + '20';

  }
  //for subscribe we also need the mac with changed endianness
  if (isSubscribe == true){
    //initial character index is last character
    var char_index = mac.length - 1;
    //add little endian mac
    while (char_index > 0){
      retHexMacString = retHexMacString 
                      + mac.substr(char_index - 1, 2);
      char_index = char_index - 2; //advance one hex char byte
    }
    //fill up the rest with padding
    while (retHexMacString.length < 48){
      retHexMacString = retHexMacString + '20';
    }
  }
  return retHexMacString;
}

function createPowerStateHexString(powerState){
  _l("createPowerStateHexString",LEVEL_TRACE);
  //currently not known what the padding 0s do here
  var retPowerStateHexString = '00000000';
  if (powerState == true){
    retPowerStateHexString = retPowerStateHexString + '01';
  }
  else{
    //we default to off
    retPowerStateHexString = retPowerStateHexString + '00';
  }
  return retPowerStateHexString;
}

function powerStateHexStringToBoolean(powerStateHexString){
  shortPowerStateHexString = powerStateHexString.substr(powerStateHexString.length - 2, 2);
  if (shortPowerStateHexString == '01'){
    return true;
  }
  return false;
}

//general helpers
function _l(message,level){
  //logging function
  if (level === undefined){
    //default to level info
    level = LEVEL_DEBUG;
  }

  if (message === undefined){
    //default to level info
    message = 'message not defined!';
  }

  switch (level){
    case LEVEL_TRACE:
      if (LEVEL_CURRENT >= LEVEL_TRACE){
        console.log('TRACE: ' + message);
      }
      break;
    case LEVEL_DEBUG:
      if (LEVEL_CURRENT >= LEVEL_DEBUG){
        console.log('DEBUG: ' + message);
      }
      break;
    case LEVEL_INFO:
      if (LEVEL_CURRENT >= LEVEL_INFO){
        console.log('INFO: ' + message);
      }
      break;
    case LEVEL_ERROR:
      if (LEVEL_CURRENT >= LEVEL_ERROR){
        console.log('ERROR: ' + message);
      }
      break;
  }
}


function createHexLengthString(length){
  //return length in hex padded with 0s on the left
  return (0x10000 + length).toString(16).substr(-4);
}

function hexStringToAsciiString(hexString){
  stringBuffer = new Buffer(hexString,'hex');
  return stringBuffer.toString('ascii');
}


//interface part
var Orvibo = function() {
    self = this;
    e.EventEmitter.call(this);
    var LOCAL_IP = "0.0.0.0";
    //and bind the UDP server to all interfaces
    server.bind(PORT, LOCAL_IP, function(){
      server.setBroadcast(true);
      _l('UDP Server ready for sending',LEVEL_INFO);
      self.emit("serverReady");
    })

    server.on('listening', function () {
        var address = server.address();
        //self.emit("serverReady")
        _l('UDP Server listening on ' + address.address + ":" + address.port, LEVEL_INFO);
    });

    server.on('error', function(err){
      _l('Server:' + err, LEVEL_ERROR);
    });

    server.on('message', function (message, remote) {
        _l(remote.address + ':' + remote.port +' - ' + message.toString('hex'),LEVEL_DEBUG);
        parseMessage(message, remote);
    });



};

util.inherits(Orvibo, e.EventEmitter);

//discover interface
Orvibo.prototype.discover = function(callback){
  createDiscoveryBuffer(function(buffer,callback){
    //discover devices
    sendBuffer(BROADCAST_IP,createDiscoveryBuffer());
  })
}

//outlet interface
Orvibo.prototype.changePowerState = function(ip, mac, state){
  _l('changePowerState for ' + ip + ' with state ' + state, LEVEL_INFO);
  //subscribe first
  return self.subscribe(ip,mac).then(function(){
    var retryCount = 0;

    var retryInterval = setInterval(function() {
      retryCount++;
      _l('retry changePowerState = ' + retryCount, LEVEL_DEBUG);
      sendBuffer(ip,createPowerStateBuffer(mac,state));
    }, 500);
    
    var waitForSuccess = function(ip,mac,state){
      var successPromise = promise.pending();
      self.once('changePowerStateSuccessful', function(successIp, successMac, successState){
        if ((ip == successIp) && (mac == successMac) && (state == successState)){
          //changePowerState answer received with correct ip/mac
          successPromise.resolve(true);
          _l('success for changePowerState: ' + ip + '/' + mac + '/' + state, LEVEL_DEBUG);
          //don't retry
          clearInterval(retryInterval);
        }
        else{
          successPromise.resolve(waitForSuccess(ip,mac,state));
          _l('changePowerStateSuccessful for wrong data', LEVEL_DEBUG);
        }
      });
      return successPromise.promise;
    };


    //send as soon as successfully subscribed
    _l('subscribed, now sending command', LEVEL_TRACE);
    sendBuffer(ip,createPowerStateBuffer(mac,state));

    return waitForSuccess(ip, mac, state).timeout(TIMEOUT).catch(promise.TimeoutError, function(){
      _l('retry changePowerState timed out. Tries = ' + retryCount, LEVEL_DEBUG);
      clearInterval(retryInterval);
      return promise.reject();
    });
  });
}

//outlet interface
Orvibo.prototype.getPowerState = function(ip, mac){
  //using subscribe to get powerstate
  _l('getPowerState for ' + ip, LEVEL_INFO);
  var retryCount = 0;

  var retryInterval = setInterval(function() {
    retryCount++;
    _l('retry getPowerState = ' + retryCount, LEVEL_DEBUG);
    sendBuffer(ip,createSubscribeBuffer(mac));
  }, 500);
  
  var waitForSuccess = function(ip,mac){
    var successPromise = promise.pending();
    var retPowerState = false;
    self.once('subscribeSuccessful', function(successIp, successMac, powerState){
      if ((ip == successIp) && (mac == successMac)){
        //subscribe answer received with correct ip/mac
        successPromise.resolve(powerState);
        _l('success for subscribe in order to get powerstate: ' + ip + '/' + mac + '/' + powerState.toString(), LEVEL_DEBUG);
        //don't retry
        clearInterval(retryInterval);
      }
      else{
        successPromise.resolve(waitForSuccess(ip,mac));
        _l('subscribeSuccessful for wrong data: '+ ip + '=' + successIp + '/' + mac  + '=' + successMac , LEVEL_DEBUG);
      }
    });
    return successPromise.promise;
  };

  //send command
  _l('sending command', LEVEL_TRACE);
  sendBuffer(ip,createSubscribeBuffer(mac));

  return waitForSuccess(ip, mac).timeout(TIMEOUT).catch(promise.TimeoutError, function(){
    _l('retry getPowerState timed out. Tries = ' + retryCount, LEVEL_DEBUG);
    clearInterval(retryInterval);
    return promise.reject("timeout");
  });
}

//outlet interface
Orvibo.prototype.subscribe = function(ip, mac){

  var retryCount = 0;

  var retryInterval = setInterval(function() {
    retryCount++;
    _l('retry subscribe = ' + retryCount, LEVEL_DEBUG);
    sendBuffer(ip,createSubscribeBuffer(mac));
  }, 500);

  var waitForSuccess = function(ip,mac){
    var successPromise = promise.pending();
    self.once('subscribeSuccessful', function(successIp, successMac){
      if ((ip == successIp) && (mac == successMac)){
        //subscribe answer received with correct ip/mac
        successPromise.resolve();
        _l('success for subscribe: ' + ip + '/' + mac , LEVEL_DEBUG);
        //don't retry
        clearInterval(retryInterval);
      }
      else{
        successPromise.resolve(waitForSuccess(ip,mac));
        _l('subscribeSuccessful for wrong data: '+ ip + '=' + successIp + '/' + mac  + '=' + successMac , LEVEL_DEBUG);
      }
    });
    return successPromise.promise;
  };

  //subscribe
  sendBuffer(ip,createSubscribeBuffer(mac));

  return waitForSuccess(ip,mac).timeout(TIMEOUT).catch(promise.TimeoutError, function(){
    _l('retry subscribe timed out. Tries = ' + retryCount, LEVEL_DEBUG);
    clearInterval(retryInterval);
    return promise.reject("timeout");
  });
}

module.exports = new Orvibo();