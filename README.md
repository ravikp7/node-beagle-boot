# node-beagle-boot  [![Build Status](https://travis-ci.org/ravikp7/node-beagle-boot.svg?branch=master)](https://travis-ci.org/ravikp7/node-beagle-boot)
#### Project status: UNDER DEVELOPMENT
A node.js bootloader server running over usb connection for BeagleBone hardware which can boot it into usb mass storage mode utilising the uboot's ums feature for flashing purposes.

This project is developed during Google Summer of Code 2017 under BeagleBoard Organisation.

This project is a port of [BBBlfs](https://github.com/ungureanuvladvictor/BBBlfs), a bootloader server for BeagleBone Black written in C language to JavaScript (node.js)

This project differs from BBBlfs in the way of booting into usb mass storage mode. BBBlfs utilizes a Kernel/ Ramdisk approach for the same and this new tool will be using uboot's ums feature for the same purpose. See [this video](https://www.youtube.com/watch?v=5JYfh2_0x8s) for more info about the project.

The ultimate goal for this project is to integrate this bootloader server to an [etcher.io](https://etcher.io) like tool to make a complete flashing tool for BeagleBone hardware.
The tool works as:

1. TFTP transfer of SPL binary and u-boot. 
2. Utilizing the ums feature of u-boot, booting the BB hardware into USB mass storage mode. 
3. Flashing the BB hardware with etcher.io like tool

#### Code for complete app [here](https://github.com/ravikp7/BeagleBoot)

## Recommended node version 6+

### Installation of prerequisite packages:
### Linux
#### Ubuntu / Debian
1. Run command to install usb drivers
```
sudo apt-get install build-essential libudev-dev
```

### Windows
1. Connect BB through usb by holding down S2 (boot button).
2. Install am335x usb drivers through [Zadig](http://zadig.akeo.ie/).
3. Open Zadig, select Options -> List all devices. Select AM335x usb from list and install WinUSB driver.
 

### OSX
1. Run command to install usb drivers
```
brew install libusb
```

## Installation
___
```
npm install --save beagle-boot
```

## API Documentation
___
### require('beagle-boot').usbMassStorage() => `EventEmitter`
The returned EventEmitter instance emits following events:
* `progress`: A progress event that passes state object of form:
```
{
    description: 'ARP request sent',    // Current status
    complete: 20    // Percent complete
}
```
* `done`: An event emitted after process success which passes nothing.
* `error`: An error event which passes error.

### Example
___
```
var BB = require('beagle-boot');

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
```

### Steps before running this module:
* Connect BB through usb by holding down S2 (boot button).

It should now boot BB into usb mass storage mode.


