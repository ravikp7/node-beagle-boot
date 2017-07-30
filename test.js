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