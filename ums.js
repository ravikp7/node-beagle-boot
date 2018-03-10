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

emitter.on('connect', function(device){
    if(device === 'UMS') console.log('Ready for Flashing!');
});

/*
// Same function to trasnfer SPL and UBOOT for USB Mass Storage using the API
// All binaries must be placed in 'bin/'
BB.tftpServer([
    {vid: 0x0451, pid: 0x6141, bootpFile: 'u-boot-spl.bin'},
    {vid: 0x525, pid: 0xa4a2, bootpFile: 'u-boot.img'}
]);
*/