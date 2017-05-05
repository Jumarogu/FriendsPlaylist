var express = require('express');
var spotifyWebAPI = require('spotify-web-api-node');
var bodyParser = require('body-parser');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
var path = require('path');
var session = require('express-session');
var sleep = require('sleep');

var MongoClient = require('mongodb').MongoClient;
var assert = require('assert');
var ObjectId = require('mongodb').ObjectID;
var dburl = 'mongodb://192.168.1.73:27017/playlist?w=1';
//var dburl = 'mongodb://juma:juma@ds123371.mlab.com:23371/jumarogu?w=1';

var app = express();
var port = process.env.PORT || 8080;
var router = express.Router();

var stateKey = 'spotify_auth_state';
var client_id = '4dac1f5b03e545e3874ea32d0d04fb9d';
var client_secret = '1f96d242e8434d809c269088e642c50e';
var scope = 'playlist-modify-public user-library-read user-read-private user-top-read playlist-modify-public user-read-email user-read-private';
var redirect_uri_IP = 'http://192.168.1.73:8080/success';
var redirect_uri_d = 'http://192.168.0.117:8080/deliver'


var spotifyAPI = new spotifyWebAPI({
  clientId : client_id,
  clientSecret : client_secret,
  redirectUri : redirect_uri_IP
});

app.set('view engine', 'pug');
app.set("views", path.join(__dirname, "views"));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));
app.use(cookieParser());
app.use('/static', express.static(__dirname + '/public'));
app.use(session({
  secret: 'this is a secret',
  resave: false,
  saveUninitialized: true,
  playlistCode: '',
  isGetPlay: null
}
));

router.use(function(req, res, next){
  //do logging
  console.log('something is happening');

  if(req.body.playlistCode != undefined){
    req.session.playlistCode = req.body.playlistCode;
    console.log('Play code ' + req.body.playlistCode);
  }
  if(req.body.playlistName != undefined){
    req.session.playlistName = req.body.playlistName;
    console.log(req.session.playlistName);
  }
  next(); // make sure we go to the next routes and don`t stop here
});

router.get('/', function (req, res) {
  req.session.isGetPlay = false;
  req.session.playlistCode = null;
  res.render('index');
});

router.get('/login', function (req, res) {

  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  // your application requests authorization
  res.redirect('https://accounts.spotify.com/authorize?' +
  querystring.stringify({
    response_type: 'code',
    client_id: client_id,
    scope: scope,
    redirect_uri: redirect_uri_IP,
    state: state
  })
);
});

router.get('/success', function(req, res){

  var authorizationCode = req.query.code;

  spotifyAPI.authorizationCodeGrant(authorizationCode)
  .then(function(data) {

    console.log('Retrieved access token', data.body['access_token']);

    // Set the access token
    spotifyAPI.setAccessToken(data.body['access_token']);

    // Use the access token to retrieve information about the user connected to it
    //return spotifyAPI.getMe();
    if(req.session.isGetPlay){
      res.redirect('/success-playlist-view');
    } else {
      res.redirect('/success-view');
    }
  })
  .catch(function(err) {

    console.log('Something went wrong', err.message);

  });
});

router.get('/join', function(req, res){
  req.session.isGetPlay = false;
  res.render('join');
});

router.get('/success-view', function(req, res) {

  var playlistCode;
  var username;

  if(req.session.playlistCode != undefined){
    playlistCode = req.session.playlistCode;
  }
  else {
    playlistCode = generateRandomString(5);
  }
  console.log(playlistCode);

  // api.getme();
  spotifyAPI.getMe()
  .then(function(data) {

    username = data.body.display_name;
    req.session.user_id = data.body.id;
    console.log(data.body.id);

    console.log(JSON.stringify(data.body, null, 2));
    return spotifyAPI.getMySavedTracks({
      limit : 20,
      offset: 1
    });
  })
  .then(function(data){

    MongoClient.connect(dburl, function(err, db) {
      assert.equal(null, err);

      console.log(data.body.items.length);
      for (var i = data.body.items.length - 1; i >= 0; i--) {
        insertArtist(db, function() { db.close();},
        playlistCode, data.body.items[i]);
      }
    });

    res.render('success', {
      user: username,
      playCode: playlistCode
    });
  })
  .catch(function(err){
    console.log(err)
  });
  /**/
});

router.get('/success-playlist-view', function(req, res) {

  var playlistCode;
  var playlistName;
  var username;
  var userid;

  if(req.session.playlistCode != undefined && req.session.playlistName != undefined){
    playlistCode = req.session.playlistCode;
    playlistName = req.session.playlistName;
  }
  else {
    playlistCode = generateRandomString(5);
    playlistName = 'No name playlist';
  }
  console.log("code: " + playlistCode + " name : " + playlistName);

  spotifyAPI.getMe()
  .then(function(data) {
    username = encodeURIComponent(data.body.display_name);
    userid = data.body.id;
    req.session.userid = userid;
    var collection = 'Artist'+playlistCode;
    var outCollection = 'Songs'+playlistCode;

    MongoClient.connect(dburl, function(err, db) {
      assert.equal(null, err);

      db.command(
        {
          mapReduce: collection,
          map: mapFunction.toString(),
          reduce: reduceFunction.toString(),
          out: outCollection
        })
        .then(function(data){
          console.log("dataa " + JSON.stringify(data, null, 2));
        }).catch(function(err){
          console.log('Something went wrong ', err);
        });
    });

    outCollection = encodeURIComponent('Songs'+playlistCode);

    res.redirect('/upload?user='+username+'&playlistName='+playlistName+'&playlistCode='+playlistCode+'&outCollection='+outCollection+'&userid='+userid);
  })
  .catch(function(error) {
    console.log('Something went wrong and i ', err);
  });
});

router.get('/upload', function(req, res){

  var user_id = req.session.user_id;
  var userid = req.query.userid;
  var username = req.query.user;
  var playlistName = req.query.playlistName;
  var outCollection = req.query.outCollection
  var playlistID;
  var playlistCode = req.query.playlistCode;

  spotifyAPI.createPlaylist(user_id, req.query.playlistName, { 'public' : true })
  .then(function(data) {
    playlistID = data.body.id;
    console.log('Created playlist!' + JSON.stringify(data.body.id));
    var songs = [];

    MongoClient.connect(dburl, function(err, db) {
      assert.equal(null, err);
      assert.ok(db != null);

      db.collection(outCollection).find({}).toArray(function(err, docs) {
        for (var i = 0; i < docs.length; i++) {

          var str = docs[i]._id;
          console.log("str: " + str);
          if(docs[i].value > 1){
              songs.push(str);
          }
          //songs[i] = docs[i]._id;
        }
        console.log('ya casi!!!!!');
      });
    });
    for(var i = 0; i < songs.length; i++){
      console.log('song uri: ' + songs[i]);
      insertSongOnPlaylist(spotifyAPI, user_id, playlistID, songs[i]);
    }
    //return spotifyAPI.addTracksToPlaylist(user_id, playlistID, songs.toString());
  })
  .then(function(data){
    console.log("songs added "+JSON.stringify(data));
    res.render('success-playlist', {
      user: username,
      playlistName: playlistName,
      playlistCode: playlistCode
    });
  })
  .catch(function(err) {
    console.log('Something went wrong on inserting songs! ', err);
  });
});
router.get('/playlist', function(req, res){

  res.render('playlist');
});

router.post('/get-playlist', function(req, res){
  if(req.body.playlistCode != '' && req.body.playlistName != ''){

    console.log("this is my get code " + req.body.playlistCode);
    console.log("playlist name " + req.body.playlistName);
    var code = encodeURIComponent(req.body.playlistCode);
    var name = encodeURIComponent(req.body.playlistName);
    req.session.isGetPlay = true;
    res.redirect('/login?code='+code+'&name='+name);
  }
  else{
    res.json({message: 'no code or name introduced'});
  }
});

router.post('/join-playlist', function(req, res){

  if(req.body.playlistCode != ''){
    console.log("this is my join code " + req.body.playlistCode);
    var code = encodeURIComponent(req.body.playlistCode);
    res.redirect('/login?playlistCode='+code);
  }
  else{
    res.json({message: 'no code introduced'});
  }
});

var mapFunction = function(){

  emit(this.track.uri, 1);
}

var reduceFunction = function(key, values){

  return Array.sum(values);
}

var insertArtist = function(db, callback, code, data) {

  db.collection('Artist'+code+'').insertOne(data, function(err, result) {
    assert.equal(err, null);
    console.log("Inserted a document into the Artist"+ code +" collection.");
    callback();
  });
};

var insertSongOnPlaylist = function(spotifyAPI, user_id, playlistID, song_id){
  spotifyAPI.addTracksToPlaylist(user_id, playlistID, song_id)
  .then(function(data) {
    console.log('Added track to playlist!');
  }, function(err) {
    console.log('Something went wrong!', err);
  });
}

var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

app.use('/', router);

app.listen(port);
console.log('magic is happening on port' + port);
