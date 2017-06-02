const ROMVID = 0x0451;
const ROMPID = 0x6141;
const BOOTPS = 67;
const BOOTPC = 68;
const IPUDP = 17;
const SPLVID = 0x0525;
const SPLPID = 0xA4A2;
const ETHIPP = 0x0800;
const ETHARPP = 0x0806;

// Size of all packets
var rndisSize = 44;
var etherSize = 14;
var arp_Size = 28;
var ipSize = 20;
var udpSize = 8;
var bootpSize = 300;
var tftpSize = 4;
var fullSize = 386;


// Include modules
var usb = require('usb');


// Connect to BeagleBone
var device = usb.findByIds(ROMVID, ROMPID);
device.open();
var interface = device.interface(1);    // Select interface 1

// Detach Kernel Driver
if(interface.isKernelDriverActive()){
    interface.detachKernelDriver();
}

interface.claim();                      

// Set endpoints for usb transfer
var inEndpoint = interface.endpoint(0x81);
var outEndpoint = interface.endpoint(0x02);

// Receive BOOTP
inEndpoint.timeout = 1000;
inEndpoint.transfer(450, onFirstIn);
function onFirstIn(error, data) {
        console.log(error);
        console.log(data);

}

