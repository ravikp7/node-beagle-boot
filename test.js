var BB = require('./main');

var ums = BB.usbMassStorage();

ums.on('progress', function(status){
    console.log(status);
});

ums.on('done', function(){
    console.log('Select Image');
});

ums.on('error', function(error){
    console.log('Error: '+error);
});