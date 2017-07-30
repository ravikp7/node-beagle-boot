var BB = require('./main');

var emitter = BB.eventEmitter;

emitter.on('progress', function(status){
    console.log(status);
});

emitter.on('done', function(){
    console.log('Select Image');
});

emitter.on('error', function(error){
    console.log('Error: '+error);
});

emitter.on('disconnect', function(device){
    console.log(device + ' device got disconnected');
});

BB.usbMassStorage();

/*
Same function to trasnfer SPL and UBOOT for USB Mass Storage using the File Transfer API
BB.tftpServer([
    {vid: 0x0451, pid: 0x6141, file_path: './bin/spl'},
    {vid: 0x525, pid: 0xa4a2, file_path: './bin/uboot'}
]);
*/