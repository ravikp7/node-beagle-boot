var BB = require('./main');

var emitter = BB.usbMassStorage();

console.log('Server started');
console.log('Connect BeagleBone to get started');

emitter.on('progress', function(status){
  console.log(status);
});

emitter.on('error', function(error){
  console.log('Error: '+error);
});

var lastServer;
emitter.on('ncStarted', function(server){
  lastServer = server;
});

process.stdin.setEncoding('ascii');
process.stdin.on('readable', function(){
  var data = process.stdin.read();
  if(data != null) {
    if(lastServer) {
      emitter.emit('ncin', lastServer, new Buffer(data));
    }
  }
});


/*
// Same function to trasnfer SPL and UBOOT for USB Mass Storage using the API
// All binaries must be placed in 'bin/'
BB.tftpServer([
    {vid: 0x0451, pid: 0x6141, bootpFile: 'u-boot-spl.bin'},
    {vid: 0x525, pid: 0xa4a2, bootpFile: 'u-boot.img'}
]);
*/
