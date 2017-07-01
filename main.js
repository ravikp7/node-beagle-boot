const ROMVID = 0x0451;
const ROMPID = 0x6141;
const BOOTPS = 67;
const BOOTPC = 68;
const IPUDP = 17;
const SPLVID = 0x0525;
const SPLPID = 0xA4A2;
const ETHIPP = 0x0800;
const ETHARPP = 0x0806;
const MAXBUF = 450;
const server_hwaddr = [0x9a, 0x1f, 0x85, 0x1c, 0x3d, 0x0e];
const server_ip = [0xc0, 0xa8, 0x01, 0x09];     // 192.168.1.9
const BB_ip = [0xc0, 0xa8, 0x01, 0x03];         // 192.168.1.3
const servername = [66, 69, 65, 71, 76, 69, 66, 79, 79, 84];       // ASCII ['B','E','A','G','L','E','B','O','O','T']
const file_spl = [83, 80, 76, 0, 0];                             // ASCII ['S','P','L']
const file_uboot = [85, 66, 79, 79, 84];                           // ASCII ['U','B','O','O','T']

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
var protocols = require('./src/protocols');
var deasync = require('deasync');
var EventEmitter = require('events').EventEmitter;
var emitter = new EventEmitter();
var fs = require('fs');
var os = require('os');
var platform = os.platform();
var rndis_win = require('./src/rndis_win');

// Set usb debug log
//usb.setDebugLevel(4);   


// Function for InEnd Bulk Transfer
function inTransfer(inEndpoint, process){
    inEndpoint.transfer(MAXBUF, (error, data) => process(data));
}


// Function for OutEnd Bulk Transfer
function outTransfer(outEndpoint, data, process){
    outEndpoint.transfer(data, (error) => process("Done"));
}



// Connect to BeagleBone
var device;
console.log("Connect your BeagleBone..");
while(device === undefined){
device = usb.findByIds(ROMVID, ROMPID);
}

device.open();
var interface = device.interface(1);    // Select interface 1 for BULK transfers

var windows = 0;
if(platform == 'win32') windows = 1; 

if(!windows){                // Not supported in Windows
// Detach Kernel Driver
if(interface.isKernelDriverActive()){
    interface.detachKernelDriver();
}
}

interface.claim();

// Windows specific code to initialize RNDIS device
if(windows){
    var intf0 = device.interface(0);    // Select interface 0 for CONTROL transfer
    intf0.claim();

    var CONTROL_BUFFER_SIZE = 1025;  
    var rndis_init_size = 24;
    var rndis_set_size = 28;

    var rndis_buf = Buffer.alloc(CONTROL_BUFFER_SIZE);
    var init_msg = rndis_win.make_rndis_init();
    init_msg.copy(rndis_buf, 0, 0, rndis_init_size);


    // Windows Control Transfer
    // https://msdn.microsoft.com/en-us/library/aa447434.aspx
    // http://www.beyondlogic.org/usbnutshell/usb6.shtml

    var bmRequestType_send = 0x21; // USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE
    var bmRequestType_receive = 0xA1; // USB_DATA=DeviceToHost | USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE

    // Sending rndis_init_msg (SEND_ENCAPSULATED_COMMAND)
    device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, function(error, data){
        console.log(error);
    });

    // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
    device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, function(error, data){
        console.log(data);
    });


    var set_msg = rndis_win.make_rndis_set();
    set_msg.copy(rndis_buf, 0, 0, rndis_set_size+4);

    // Send rndis_set_msg (SEND_ENCAPSULATED_COMMAND)
     device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, function(error, data){
        console.log(error);
    });

    // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
    device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, function(error, data){
        console.log(data);
    });

}                      

// Set endpoints for usb transfer
var inEndpoint = interface.endpoint(0x81);
var outEndpoint = interface.endpoint(0x02);

// Set endpoint transfer type
inEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
outEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;

// Receive BOOTP
var bootp_buf = Buffer.alloc(MAXBUF-rndisSize);     // Buffer for InEnd transfer
inEndpoint.timeout = 0;                          
inEndpoint.transfer(MAXBUF, onFirstIn);             // InEnd transfer
var done = false;                                   // Boolean for sync function
function onFirstIn(error, data) {                   // Callback for InEnd transfer
        data.copy(bootp_buf, 0, rndisSize, MAXBUF);
        done = true;
}
deasync.loopWhile(function(){return !done;});       // Synchronize InEnd transfer function

var ether = protocols.decode_ether(bootp_buf);      // Gets decoded ether packet data

var rndis = protocols.make_rndis(fullSize-rndisSize);   // Make RNDIS

var eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHIPP);    // Make ether2

var ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + bootpSize, 0); // Make ipv4

var udp = protocols.make_udp(bootpSize, BOOTPS, BOOTPC);    // Make udp

var bootreply = protocols.make_bootp(servername, file_spl, 1, ether.h_source, BB_ip, server_ip);    // Make BOOTP for reply

var data = Buffer.concat([rndis, eth2, ip, udp, bootreply], fullSize);      // BOOT Reply

// Send BOOT reply
outEndpoint.timeout = 0;
done = false;                                           
outEndpoint.transfer(data, function(error){
    done = true;
});
deasync.loopWhile(function(){return !done;});           // Synchronize OutEnd transfer

// Receive ARP request
var arp_buf = Buffer.alloc(arp_Size);
inEndpoint.timeout = 0;
done = false;
inEndpoint.transfer(MAXBUF, function(error, data){
    data.copy(arp_buf, 0, rndisSize + etherSize, rndisSize + etherSize + arp_Size);
    done = true;
});
deasync.loopWhile(function(){ return !done;});

var receivedARP = protocols.parse_arp(arp_buf);         // Parsed received ARP request

// ARP response
var arpResponse = protocols.make_arp(2, server_hwaddr, receivedARP.ip_dest, receivedARP.hw_source, receivedARP.ip_source );

rndis = protocols.make_rndis(etherSize + arp_Size);

eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHARPP);

data = Buffer.concat([rndis, eth2, arpResponse], rndisSize + etherSize + arp_Size);

// Send ARP response
outEndpoint.timeout = 0;
done = false;                                           
outEndpoint.transfer(data, function(error){
    done = true;
});
deasync.loopWhile(function(){return !done;});

// Receive SPL TFTP request
var udpSPL_buf = Buffer.alloc(udpSize);
inEndpoint.timeout = 0;
done = false;
inEndpoint.transfer(MAXBUF, function(error, data){
    data.copy(udpSPL_buf, 0, rndisSize + etherSize + ipSize, rndisSize + etherSize + ipSize + udpSize);
    done = true;
});
deasync.loopWhile(function(){ return !done;});

var udpSPL = protocols.parse_udp(udpSPL_buf);           // Received UDP packet for SPL tftp


////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////// SPL File Transfer ////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////
console.log("SPL transfer starts");

var spl = fs.readFileSync("./bin/spl");
var blocks = Math.ceil(spl.length/512);         // Total number of blocks of file

eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHIPP);    

var start = 0;                                  // Source start for copy

for(var i=1; i<=blocks; i++){                   // i is block number
    
    var blk_size = (i==blocks)? spl.length - (blocks-1)*512 : 512;  // Different block size for last block

    var blk_data = Buffer.alloc(blk_size);
    spl.copy(blk_data, 0, start, start + blk_size);                 // Copying data to block
    start += blk_size; 

    rndis = protocols.make_rndis(etherSize + ipSize + udpSize + tftpSize + blk_size);
    ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + tftpSize + blk_size, 0);
    udp = protocols.make_udp(tftpSize + blk_size, udpSPL.udpDest, udpSPL.udpSrc);
    tftp = protocols.make_tftp(3, i);

    var spl_data = Buffer.concat([rndis, eth2, ip, udp, tftp, blk_data], rndisSize + etherSize + ipSize + udpSize + tftpSize + blk_size);

    // Send SPL file data
    outEndpoint.timeout = 0;
    done = false;                                           
    outEndpoint.transfer(spl_data, function(error){
    done = true;
    });
    deasync.loopWhile(function(){return !done;});

    // Receive buffer back
    inEndpoint.timeout = 0;
    done = false;
    inEndpoint.transfer(MAXBUF, function(error, data){
    done = true;
    });
    deasync.loopWhile(function(){ return !done;});
}
console.log("SPL transfer complete");


// Wait for SPL initialization
function sleep(milliseconds) {
  var start = new Date().getTime();
  for (var i = 0; i < 1e7; i++) {
    if ((new Date().getTime() - start) > milliseconds){
      break;
    }
  }
}
sleep(2000);



// Connect to BeagleBone via SPL
device = usb.findByIds(SPLVID, SPLPID);
device.open();
interface = device.interface(1);    

if(!windows){
// Detach Kernel Driver
if(interface.isKernelDriverActive()){
    interface.detachKernelDriver();
}
}

interface.claim();                      
console.log("SPL started running");

// Set endpoints for usb transfer
inEndpoint = interface.endpoint(0x81);
outEndpoint = interface.endpoint(0x01);

// Set endpoint transfer type
inEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
outEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;

// Receive BOOTP
var udpUboot_buf = Buffer.alloc(udpSize);
var spl_bootp_buf = Buffer.alloc(bootpSize);
inEndpoint.timeout = 0;
var done = false;                            
inEndpoint.transfer(MAXBUF, function (error, data) { 
        data.copy(udpUboot_buf, 0, rndisSize + etherSize + ipSize, MAXBUF);       
        data.copy(spl_bootp_buf, 0, rndisSize + etherSize + ipSize + udpSize, MAXBUF);
        done = true;
});             
deasync.loopWhile(function(){return !done;});    

var udpUboot = protocols.parse_udp(udpUboot_buf);       // parsed udp header
var spl_bootp = protocols.parse_bootp(spl_bootp_buf);   // parsed bootp header

rndis = protocols.make_rndis(fullSize - rndisSize);
eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHIPP);
ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + bootpSize, 0);
udp = protocols.make_udp(bootpSize, udpUboot.udpDest, udpUboot.udpSrc);
bootreply = protocols.make_bootp(servername, file_uboot, spl_bootp.xid, ether.h_source, BB_ip, server_ip);

data = Buffer.concat([rndis, eth2, ip, udp, bootreply], fullSize);

// Send BOOT reply
outEndpoint.timeout = 0;
done = false;                                           
outEndpoint.transfer(data, function(error){
    done = true;
});
deasync.loopWhile(function(){return !done;});

// Receive ARP request
inEndpoint.timeout = 0;
done = false;
inEndpoint.transfer(MAXBUF, function(error, data){
    //data.copy(arp_buf, 0, rndisSize + etherSize, rndisSize + etherSize + arp_Size);
    done = true;
});
deasync.loopWhile(function(){ return !done;});


// ARP response
arpResponse = protocols.make_arp(2, server_hwaddr, receivedARP.ip_dest, receivedARP.hw_source, receivedARP.ip_source );

rndis = protocols.make_rndis(etherSize + arp_Size);

eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHARPP);

data = Buffer.concat([rndis, eth2, arpResponse], rndisSize + etherSize + arp_Size);

// Send ARP response
outEndpoint.timeout = 0;
done = false;                                           
outEndpoint.transfer(data, function(error){
    done = true;
});
deasync.loopWhile(function(){return !done;});


// Receive UBOOT TFTP request
var udpUBOOT_buf = Buffer.alloc(udpSize);
inEndpoint.timeout = 0;
done = false;
inEndpoint.transfer(MAXBUF, function(error, data){
    data.copy(udpUBOOT_buf, 0, rndisSize + etherSize + ipSize, rndisSize + etherSize + ipSize + udpSize);
    done = true;
});
deasync.loopWhile(function(){ return !done;});

var udpUBOOT = protocols.parse_udp(udpUBOOT_buf);           // Received UDP packet for UBOOT tftp   


////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////// UBOOT File Transfer ////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////
console.log("Uboot transfer starts");

var uboot = fs.readFileSync("./bin/uboot");
blocks = Math.ceil(uboot.length/512);         // Total number of blocks of file

eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHIPP);    

start = 0;                                  // Source start for copy

for(var i=1; i<=blocks; i++){                   // i is block number
    
    blk_size = (i==blocks)? uboot.length - (blocks-1)*512 : 512;  // Different block size for last block

    blk_data = Buffer.alloc(blk_size);
    uboot.copy(blk_data, 0, start, start + blk_size);                 // Copying data to block
    start += blk_size; 

    rndis = protocols.make_rndis(etherSize + ipSize + udpSize + tftpSize + blk_size);
    ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + tftpSize + blk_size, 0);
    udp = protocols.make_udp(tftpSize + blk_size, udpUBOOT.udpDest, udpUBOOT.udpSrc);
    tftp = protocols.make_tftp(3, i);

    uboot_data = Buffer.concat([rndis, eth2, ip, udp, tftp, blk_data], rndisSize + etherSize + ipSize + udpSize + tftpSize + blk_size);

    // Send SPL file data
    outEndpoint.timeout = 0;
    done = false;                                           
    outEndpoint.transfer(uboot_data, function(error){
    done = true;
    });
    deasync.loopWhile(function(){return !done;});

    // Receive buffer back
    inEndpoint.timeout = 0;
    done = false;
    inEndpoint.transfer(MAXBUF, function(error, data){
    done = true;
    });
    deasync.loopWhile(function(){ return !done;});
}

console.log("Ready for flashing in a bit..");