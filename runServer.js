var BB = require('./main');

console.log(`Choose Option: \n1. Bootloader Server \n2. TCP/IP Proxy Server`);
process.stdin.on('data', (data) => {
  const result = data.toString();
  if (result === '1\n') {
    bootloaderServer();
    process.stdin.removeAllListeners();
  }
  else if (result === '2\n') {
    proxyServer();
    process.stdin.removeAllListeners();
  }
  else console.log(`Choose a valid option.`);

});

const bootloaderServer = () => {
  const emitter = BB.usbMassStorage();

  console.log('Bootloader Server started');
  console.log('Connect BeagleBone to get started');

  emitter.on('progress', function (status) {
    console.log(status);
  });

  emitter.on('error', function (error) {
    console.log('Error: ' + error);
  });

  var lastServer;
  emitter.on('ncStarted', function (server) {
    lastServer = server;
  });

  process.stdin.setEncoding('ascii');
  process.stdin.on('readable', () => {
    let data = process.stdin.read();
    if (data != null) {
      if (lastServer) {
        emitter.emit('ncin', lastServer, data);
      }
    }
  });
};

const proxyServer = () => {
  const emitter = BB.proxyServer();
  console.log(`Proxy Server started`);
  console.log(`Connect BeagleBone to get started`);

  emitter.on('error', (error) => {
    console.log(`Error: ${error}`);
  });
};