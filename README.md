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



