// Websocket Server
const WebSocketServer = require('ws').Server;
const fe = require('path');
const url = require('url');


// list of currently connected clients (users)
var clients = {};
// Any code in here will be limitted in functionality
var guests = {};

// Map code to JWT
var codeTokenMap = {};


const allowedCommands = [
  'next',
  'previous',
  'playPause',
  'addSong',
  'getPlaylist',
  'removeSong',
];
const guestCommands = [
  'addSong',
  'getPlaylist'
];


var tokenFunction = function () {
  return false;
}



// This part is run after the login code
exports.setup = function (mstream, server, program) {
  var vcFunc = function (info, cb) {
    cb(true);
  }

  // If we are logging in
  if (program.auth) {
    const jwt = require('jsonwebtoken');

    vcFunc = function (info, cb) {
      console.log(url.parse(info.req.url, true).query.token);
      var token;

      // Tokens are attached as a GET param
      try {
        token = url.parse(info.req.url, true).query.token;
      } catch (err) {
        cb(false, 401, 'Unauthorized');
        return;
      }

      if (!token) {
        cb(false, 401, 'Unauthorized');
      }
      else {
        jwt.verify(token, program.secret, function (err, decoded) {
          if (err) {
            // TODO: Delay Response
            cb(false, 401, 'Unauthorized');
          } else {
            // TODO: Verify user has no denied functions

            // We are going to create a new JWT specifically for this session
            var sendData = {
              username: decoded.username,
              restrictedFunctions: ['/db/recursive-scan', '/saveplaylist', '/deleteplaylist', '/download'] // TODO: Should probably have more in here
            }

            info.req.jwt = jwt.sign(sendData, program.secret);
            cb(true);
          }
        });

      }
    }
  }



  const wss = new WebSocketServer({ server: server, verifyClient: vcFunc });
  // This callback function is called every time someone
  // tries to connect to the WebSocket server
  // TODO: Add authentication step with jwt if necessary
  // TODO: https://gist.github.com/jfromaniello/8418116
  wss.on('connection', function (connection) {
    // accept connection - you should check 'request.origin' to make sure that
    // client is connecting from your website
    console.log((new Date()) + ' Connection accepted.');


    // Generate code and assure it doesn't exist
    var code = createAccountNumber(10000);
    var guestcode = createAccountNumber(10000);


    // Handle code failures
    if (code === false || guestcode === false) {
      connection.send(JSON.stringify({ error: 'Failed To Create Instance' }));
      return;
    }


    // Add code to clients object
    clients[code] = connection;
    // Connect guest code to standard code
    guests[guestcode] = code;


    // create JWT
    // TODO: We need to put a expiration date on the token and refresh it regularly
    var token = false;
    if (connection.upgradeReq.jwt) {
      token = connection.upgradeReq.jwt;
      codeTokenMap[code] = token;
      codeTokenMap[guestcode] = token;
    }

    // Send Code
    connection.send(JSON.stringify({ code: code, guestCode: guestcode, token: token }));

    // user sent some message
    connection.on('message', function (message) {
      // Send client code back
      connection.send(JSON.stringify({ code: code, guestCode: guestcode }));
    });


    // user disconnected
    connection.on('close', function (connection) {
      // Remove client from array
      delete guests[guestcode];
      delete clients[code];

      if (codeTokenMap[code]) {
        delete codeTokenMap[code];
        delete codeTokenMap[guestcode];
      }
    });

  });


  // Function for creating account numbers
  function createAccountNumber(limit = 100000) {
    // TODO: Check that limit is reasonably sized integer

    var n = 0;
    while (true) {
      code = Math.floor(Math.random() * (limit * 9)) + limit;
      if (!(code in clients) && !(code in guests)) {
        break;
      }
      if (n === 10) {
        console.log('Failed to create ID for jukebox.');
        // FIXME: Try again with a larger number size
        return false;
      }
      n++;
    }

    return code;
  }



  // Send codes to client
  mstream.post('/jukebox/push-to-client', function (req, res) {
    // Get client id
    var clientCode = req.body.code;
    var command = req.body.command;

    // Check that code exists
    if (!(clientCode in clients) && !(clientCode in guests)) {
      res.status(500).json({ error: 'Client code not found' });
      return;
    }

    // MAke sure command is allowed
    if (allowedCommands.indexOf(command) === -1) {
      res.status(500).json({ error: 'Command Not Recognized' });
      return;
    }

    if (clientCode in guests) {
      // Check that command does not violate guest conditions
      if (guestCommands.indexOf(command) === -1) {
        res.status(500).json({ error: 'The command is not allowed for guests' });
        return;
      }

      clientCode = guests[clientCode];
    }

    // Handle extra data for Add File Commands
    var sendFile = '';
    if (req.body.file) {
      sendFile = req.body.file;
    }

    // Push commands to client
    clients[clientCode].send(JSON.stringify({ command: command, file: sendFile }));

    // Send confirmation back to user
    res.json({ status: 'done' });
  });
}

// This part is run before the login code
exports.setup2 = function (mstream, server, program) {

  mstream.post('/jukebox/does-code-exist', function (req, res) {
    // Get client id
    const clientCode = req.body.code;

    var status;

    // Check that code exists
    if (!(clientCode in clients) && !(clientCode in guests)) {
      res.json({ status: false });
      return;
    }

    // Get Token
    var jwt = false;
    if (codeTokenMap[clientCode]) {
      jwt = codeTokenMap[clientCode];
    }

    var guestStatus = (clientCode in guests);
    res.json({ status: true, guestStatus: guestStatus, token: jwt });
  });

}
