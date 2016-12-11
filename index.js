var app = require("express")();
var server = require("http").Server(app);
var io = require("socket.io")(server);

server.listen(process.env.PORT || 8080, function() {
	console.log("Server is now running...");
});

function player(id, name, roomId, x, y, underground, alive, score, level) {
    this.id = id;
    this.name = name;
    this.roomId = roomId;
    this.x = x;
    this.y = y;
    this.underground = underground;
    this.alive = alive;
    this.score = score;
    this.level = level;
};

function room(id, owner, curPlayers, maxPlayers, open) {
	this.id = id;
	this.owner = owner;
	this.curPlayers = curPlayers;
	this.maxPlayers = maxPlayers;
	this.open = open;
};

var maxNumRooms = 50;
var minRocks = 10;
var maxRocks = 15;
var mapSize = 64;
var mapDims = 8;
var winningScore = 10;

// roomId to room
var rooms = {};

// roomId to player[]
var players = {};

// roomId to int[]
var rocks = {};

function getPlayerCoordinate(roomId) {
	var rockArr = rocks[roomId];
	while (true) {
		var playerPos = randInRange(0, mapSize-1);
		if (rockArr.indexOf(playerPos) > -1) continue;
		return {x: Math.floor(playerPos / mapDims) + 1, y: (playerPos % mapDims) + 1};
	}
};

function randInRange(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRocks() {
	var numRocks = randInRange(minRocks, maxRocks);
	var arr = [];
	while (arr.length < numRocks) {
		var rock = randInRange(0, mapSize-1);
		if (arr.indexOf(rock) > -1) continue;
		arr[arr.length] = rock;
	}
	return arr;
}

function createRoom(socket, data) {
	if (Object.keys(rooms).length > maxNumRooms) {
		console.log("Number of rooms is maxed out");
		return -1;
	}
	for (var i = 0; i < maxNumRooms; ++i) {
		if (! rooms[i]) {
			var newRoom = new room(i, data.owner, 1, data.maxPlayers, true);
			rooms[i] = newRoom;
			socket.leave("lobby");
			socket.join(i + "");
			return i;
		}
	}
	return -1;
};

function joinRoom(socket, roomId) {
	if (rooms[roomId].curPlayers === rooms[roomId].maxPlayers) {
		return false;
	}
	rooms[roomId].curPlayers += 1;
	socket.leave("lobby");
	socket.join(roomId + "");
	return true;
}

io.on("connect", function(socket) {
    socket.on("playerRegistered", function(data) {
    	if (! socket.name) {
    		console.log(data.name + " logged in.");
    		socket.name = data.name;
    	}
    	socket.level = data.level;
    	socket.join("lobby");
        socket.emit("getRooms", rooms);
    });
    socket.on("roomCreated", function(data) {
    	var roomId = createRoom(socket, data);
    	if (roomId === -1) {
    		socket.emit("roomCreationFail");
    	} else {
    		data.id = roomId;
    		socket.emit("roomCreationSuccess", data);
    		socket.broadcast.to("lobby").emit("newRoom", data);
    	}
    });
    socket.on("requestJoinRoom", function(roomId) {
    	if (joinRoom(socket, roomId)) {
    		socket.emit("joinRoomSuccess", {id: roomId});
    		socket.broadcast.to("lobby").emit("roomJoined", {id: roomId});
    	} else {
    		socket.emit("joinRoomFail");
    	}
    });
    socket.on("requestPlayer", function(data) {	
    	if (! players[data.roomId]) {
    		players[data.roomId] = [];
    	}
    	if (! rocks[data.roomId]) {
    		rocks[data.roomId] = generateRocks();
    	}
    	socket.emit("getRocks", rocks[data.roomId]);
    	socket.emit("getPlayers", players[data.roomId]);
    	// console.log(socket.name + " got players: ", players[data.roomId]);
    	var coord = getPlayerCoordinate(data.roomId);
    	socket.emit("playerCreated", {id: socket.id,
    		x: coord.x, y: coord.y, level: socket.level});

    	socket.broadcast.to(data.roomId + "").emit("playerConnected",
    		{id: socket.id, name: data.name, x: coord.x, y: coord.y, level: socket.level});

    	players[data.roomId].push(
    		new player(socket.id, data.name, data.roomId, 
    			coord.x, coord.y, false, true, 0, socket.level));

    	function playerMove(moveData) {
    		moveData.id = socket.id;
    		socket.broadcast.to(data.roomId + "").emit("playerMoved", moveData);

    		for (var i = 0; i < players[data.roomId].length; ++i) {
    			if (players[data.roomId][i].id === moveData.id) {
    				players[data.roomId][i].x = moveData.x;
    				players[data.roomId][i].y = moveData.y;
    				break;
    			}
    		}
    	}

    	function playerPop() {
    		socket.broadcast.to(data.roomId + "").emit("playerPop", {id: socket.id});
    		var roomPlayers = players[data.roomId];
    		var x;
    		var y;
    		var popperIdx;

    		for (var i = 0; i < roomPlayers.length; ++i) {
    			if (roomPlayers[i].id === socket.id) {
    				players[data.roomId][i].underground = false;
    				x = roomPlayers[i].x;
    				y = roomPlayers[i].y;
    				popperIdx = i;
					var pos = (x - 1) * mapDims + y - 1;
					if (rocks[data.roomId].indexOf(pos) > -1) {
						players[data.roomId][i].alive = false;
						players[data.roomId][i].score -= 1;
						io.in(data.roomId + "").emit("playerDie", {
							id: socket.id, killer: ""
						});
						return;
					}
    				break;
    			}
    		}

    		for (var i = 0; i < roomPlayers.length; ++i) {
    			var curPlayer = roomPlayers[i];
    			if (curPlayer.x === x && curPlayer.y === y && 
    				curPlayer.id !== socket.id &&
    				! curPlayer.underground && curPlayer.alive) {
    				players[data.roomId][i].alive = false;
    				players[data.roomId][popperIdx].score += 1;
    				io.in(data.roomId + "").emit("playerDie", {
    					id: curPlayer.id, killer: socket.id
    				});
    				if (roomPlayers[popperIdx].score === winningScore) {
    					io.in(data.roomId + "").emit("playerWin", {id: socket.id});
    					rooms[data.roomId].open = false;
    					io.in("lobby").emit("roomHidden", {id: data.roomId});
    				}
    			}
    		}
    	}

    	function playerDig() {
    		socket.broadcast.to(data.roomId + "").emit("playerDig", {id: socket.id});

    		for (var i = 0; i < players[data.roomId].length; ++i) {
    			if (players[data.roomId][i].id === socket.id) {
    				players[data.roomId][i].underground = true;
    				break;
    			}
    		}
    	}

    	function playerRespawn() {
    		var coord = getPlayerCoordinate(data.roomId);
    		io.in(data.roomId + "").emit("playerRespawn",
    			{id: socket.id, x: coord.x, y: coord.y});

    		for (var i = 0; i < players[data.roomId].length; ++i) {
    			if (players[data.roomId][i].id === socket.id) {
    				players[data.roomId][i].alive = true;
    				players[data.roomId][i].x = coord.x;
    				players[data.roomId][i].y = coord.y;
    				break;
    			}
    		}
    	}

		function quitRoom() {
			socket.broadcast.to(data.roomId + "").emit("playerDisconnected",
				{id: socket.id});
			for (var i = 0; i < players[data.roomId].length; ++i) {
				if (players[data.roomId][i].id === socket.id) {
					players[data.roomId].splice(i, 1);
					rooms[data.roomId].curPlayers -= 1;
					if (rooms[data.roomId].curPlayers === 0) {
						if (rooms[data.roomId].open) {
							socket.broadcast.to("lobby").emit("roomDestroyed", {id: data.roomId});
						}
						delete rooms[data.roomId];
						delete players[data.roomId];
						delete rocks[data.roomId];
					} else if (rooms[data.roomId].open) {
						socket.broadcast.to("lobby").emit("roomQuit", {id: data.roomId});
					}
					break;
				}
			}
		}

    	socket.on("playerMoved", playerMove);
    	socket.on("playerPopped", playerPop);
    	socket.on("playerDigged", playerDig);
    	socket.on("playerRespawned", playerRespawn);
    	socket.once("quitRoom", function() {
    		socket.leave(data.roomId + "");
    		socket.removeListener("disconnect", quitRoom);
    		socket.removeListener("playerMoved", playerMove);
    		socket.removeListener("playerPopped", playerPop);
    		socket.removeListener("playerDigged", playerDig);
    		socket.removeListener("playerRespawned", playerRespawn);
    		quitRoom();
    	});
    	socket.once("disconnect", quitRoom);
    });
	socket.once("disconnect", function() {
		if (!! socket.name) {
			console.log(socket.name + " logged out.");
		}
	});
});
