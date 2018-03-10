# node-beagle-boot  [![Build Status](https://travis-ci.org/ravikp7/node-beagle-boot.svg?branch=master)](https://travis-ci.org/ravikp7/node-beagle-boot) [![npm](https://img.shields.io/npm/v/beagle-boot.svg)](https://www.npmjs.com/package/beagle-boot)
A node.js bootloader server running over usb connection for BeagleBone hardware which can transfer bootloader files, ramdisk etc. It can also boot it into usb mass storage mode utilising the uboot's ums feature for flashing purposes.

This project is developed during `Google Summer of Code 2017 under BeagleBoard Organisation`.

This project is a port of [BBBlfs](https://github.com/ungureanuvladvictor/BBBlfs), a flashing app which integrates a bootloader server for BeagleBone Black written in C language to JavaScript (node.js)

This project differs from BBBlfs in the way of booting into usb mass storage mode. BBBlfs utilizes a Kernel/ Ramdisk approach for the same and this new tool will be using uboot's ums feature for the same purpose. See [this video](https://www.youtube.com/watch?v=5JYfh2_0x8s) for more info about the project.

The ultimate goal for this project is to integrate this bootloader server to an [etcher.io](https://etcher.io) like tool to make a complete flashing tool for BeagleBone hardware.
## Complete Flashing app [here](https://github.com/ravikp7/BeagleBoot)

### Supported Devices: All BeagleBones and PocketBone
### Supported Platforms: Linux, OSX, Windows (work in progress)

#### Working of the bootloader server
When the AM335x ROM is connected to PC by holding down boot switch, it exposes a RNDIS interface which is a virtual ethernet link over usb.
1. After running the server through API or start script, it listens to events of device connection.
2. Once it detects the device connection, it starts serving BOOTP, ARP requests and finally TFTP request for respective file transfer for the device. 
3. For USB Mass Storage functionality first TFTP trasnfer of SPL(Secondary Program Loader) is done for ROM device. SPL runs in device.
4. Now, newly connected device shows up as SPL device. TFTP trasnfer of UBOOT (configured for USB mass storage) is performed for SPL device.
5. Then UBOOT runs and mounts the emmc of device as USB mass storage device. 

## Recommended node version 6+

### Installation of prerequisite packages:
### Linux
#### Ubuntu / Debian
1. These packages are required to build libusb on linux.
```
sudo apt-get install build-essential libudev-dev
```

### Windows
1. Connect BB through usb by holding down S2 (boot button).
2. Install am335x usb drivers through [Zadig](http://zadig.akeo.ie/).
3. Open Zadig, select Options -> List all devices. Select AM335x usb from list and install WinUSB driver.

## Installation for use as standalone Server for USB mass storage purpose
1. Clone this repo. cd into it.
2. Run command for installation
```
npm install
```
3. Run following command with sudo for Linux/OSX or elevated admin cmd or PowerShell for Windows.
```
npm start
```
4. The server should be running now.
5. Connect BB through usb by holding down S2 (boot button) to begin the process.

It should now boot BB into USB Mass Storage Mode.

___
## U-boot binary build instructions:
* Use your preferred Cross Compiler or set up one from [instructions here](http://eewiki.net/display/linuxonarm/BeagleBone+Black#BeagleBoneBlack-ARMCrossCompiler:GCC)

* Get the latest U-boot sources and checkout v2018.03-rc4
```
git clone https://github.com/u-boot/u-boot.git
cd u-boot
git checkout v2018.03-rc4 -b tmp
```
* Apply RCN's Patches
```
wget https://raw.githubusercontent.com/RobertCNelson/Bootloader-Builder/master/patches/v2018.03-rc4/0001-am335x_evm-uEnv.txt-bootz-n-fixes.patch
wget https://raw.githubusercontent.com/RobertCNelson/Bootloader-Builder/master/patches/v2018.03-rc4/0002-U-Boot-BeagleBone-Cape-Manager.patch

git am 0001-am335x_evm-uEnv.txt-bootz-n-fixes.patch
git am 0002-U-Boot-BeagleBone-Cape-Manager.patch
```
* Apply default UMS(USB Mass Storage) Patch
```
wget https://raw.githubusercontent.com/ravikp7/node-beagle-boot/master/ums-patch.diff
git apply ums-patch.diff
```
* Run the following command for config:
```
make ARCH=arm CROSS_COMPILE=${CC} am335x_evm_usbspl_defconfig
```
* To enable USB Mass Storage, run command
```
make menuconfig
```
Select `Command Line Interface` -> `Device Access Commands` -> `UMS usb mass storage`

Then 'Save' and 'Exit'

* Run the following command to compile:
```
make ARCH=arm CROSS_COMPILE=${CC}
```
Now SPL binary is `spl/u-boot-spl.bin` and uboot binary is `u-boot.img`

___
## API Documentation
#### For USB Mass Storage
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
* `connect`: An event reporting device connect which passes `string` for device type `(ROM, SPL, UMS)` connected.
* `disconnect`: An event reporting device disconnect which passes `string` for device type `(ROM, SPL, UMS)` disconnected.

### Example
___
```
var BB = require('beagle-boot');

var emitter = BB.usbMassStorage();

emitter.on('progress', function(status){
    console.log(status);
});

emitter.on('done', function(){
    console.log('Transfer Complete');
});

emitter.on('error', function(error){
    console.log('Error: '+error);
});

emitter.on('connect', function(device){
    if(device === 'UMS') console.log('Ready for Flashing!');
});

emitter.on('disconnect', function(device){
    console.log(device + ' device got disconnected');
});
```
___
#### For any File transfer to respective device
### require('beagle-boot').tftpServer( [ `file transfer objects` ] ) => `EventEmitter`
This `EventEmitter` instance emits the same above events.
#### `server objects` are of following form:
```
{
    vid: vID,     // Device Vendor ID as integer
    pid: pID,     // Device Product ID as integer
    bootpFile: 'fileName'   // Binaries must be placed in 'bin/'
}
```
`The order of objects doesn't matter here`
### Example
```
var BB = require('beagle-boot');

var emitter = BB.tftpServer([
     {vid: 0x0451, pid: 0x6141, bootpFile: 'u-boot-spl.bin'},
     {vid: 0x525, pid: 0xa4a2, bootpFile: 'u-boot.img'}
]);
```
#### This API can be used to boot ramdisk also
#### Infact above usbMassStorage function server is implemented using this any file transfer API


