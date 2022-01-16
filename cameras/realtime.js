const config = {
  hostname: 'tie.digitraffic.fi',
  port: 61619,
  path: '/mqtt',
  userName: 'digitraffic',
  password: 'digitrafficPassword',
}
const savedStateStr = localStorage.getItem('position') || '{"center": [60.16, 24.9], "zoom": 10}';
const savedState = JSON.parse(savedStateStr);
const mymap = L.map('mapid').setView(savedState.center, savedState.zoom);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  'attribution': 'Map data © <a href="http://openstreetmap.org">OpenStreetMap</a> contributors'
}).addTo(mymap);
const layerGroup = L.layerGroup().addTo(mymap);


let visibleStations = []
let stations = [];

let subscribedIds = [];

async function fetchStations() {
  const response = await fetch('https://tie.digitraffic.fi/api/v1/metadata/tms-stations')
    .then(r => r.json());
  return response.features;

}
function storeMapState() {
  const center = mymap.getCenter();
  const zoom = mymap.getZoom();
  localStorage.setItem('position', JSON.stringify({
    center: [center.lat, center.lng],
    zoom
  }));
}

const isMatchingCoords = ({ minLat, minLong, maxLat, maxLong }) => (station) => {
  const [long, lat] = station.geometry.coordinates;
  return long >= minLong &&
    long <= maxLong &&
    lat >= minLat &&
    lat <= maxLat;
}

function colorGradient(fadeFraction, rgbColor1, rgbColor2, rgbColor3) {
    var color1 = rgbColor1;
    var color2 = rgbColor2;
    var fade = fadeFraction;

    // Do we have 3 colors for the gradient? Need to adjust the params.
    if (rgbColor3) {
      fade = fade * 2;

      // Find which interval to use and adjust the fade percentage
      if (fade >= 1) {
        fade -= 1;
        color1 = rgbColor2;
        color2 = rgbColor3;
      }
    }

    var diffRed = color2.red - color1.red;
    var diffGreen = color2.green - color1.green;
    var diffBlue = color2.blue - color1.blue;

    var gradient = {
      red: parseInt(Math.floor(color1.red + (diffRed * fade)), 10),
      green: parseInt(Math.floor(color1.green + (diffGreen * fade)), 10),
      blue: parseInt(Math.floor(color1.blue + (diffBlue * fade)), 10),
    };

    return 'rgb(' + gradient.red + ',' + gradient.green + ',' + gradient.blue + ')';
  }

function makeIcon(station) {
  const { speed = 0 } = station;
  const color = colorGradient(
    (speed - 30) / 90,
    {red: 255, green: 0, blue: 0},
    {red: 255, green: 255, blue: 0},
    {red: 0, green: 255, blue: 0}
  );

  const icon = new L.DivIcon({
    className: `my-speed-icon`,
    iconSize: [24,24],
    html: `<div style="background-color: ${color}">${speed || '??'}</div>`,
  });
  return icon;
}


function updateStations() {
  const currentBounds = mymap.getBounds();
  const minLong = currentBounds.getWest();
  const minLat = currentBounds.getSouth();
  const maxLong = currentBounds.getEast();
  const maxLat = currentBounds.getNorth();
  const withinBounds = stations.filter(isMatchingCoords({minLat, minLong, maxLat, maxLong}));
  visibleStations = withinBounds;
  const markers = visibleStations.map((station) => {
    const marker = stationMarker(station);
    station.marker = marker;
    return marker;
  });
  layerGroup.clearLayers();
  markers.forEach(m => m.addTo(layerGroup));
}

mymap.on('moveend', (e) => {
  _.debounce(() => {
    storeMapState();
    updateStations();
  }, 1000, { leading: true, trailing: true });
});

function stationMarker(station) {
  const { speed = 0 } = station;
  const coords = station.geometry.coordinates.slice(0, 2).reverse();
  const marker = L.marker(coords, {
    icon: makeIcon(station)
  });
  marker.bindPopup(`Address: <b>${station.properties.names.en}</b><br /> Avg speed: <b>${speed} km/h</b>`)
  return marker;
}



const client = new Paho.MQTT.Client(config.hostname, config.port, "alexeimoisseev-" + Date.now());

async function connect(client) {
  return new Promise((resolve, reject) => {
    client.connect({
      userName: config.userName,
      password: config.password,
      useSSL: true,
      onSuccess: () => {
        console.log('connected');
        resolve(client);
      },
      onFailure: (e) => {
        reject(e);
      }
    });
  });
}


async function subscribe(client, path) {
 return new Promise((resolve, reject) => {
    client.subscribe(path, {
      onSuccess: () => {
        resolve();
      },
      onFailure: (e) => {
        reject(e);
      }
    })
  });
}


function subscribeAll(client, ids) {
  return subscribe(client, 'tms/#')
}


client.onMessageArrived = (message) => {
  const payload = JSON.parse(message.payloadString);
  if (payload.name === 'KESKINOPEUS_5MIN_LIUKUVA_SUUNTA1') {
    const id = payload.roadStationId;
    const value = payload.sensorValue;
    const station = visibleStations.find(s => s.properties.roadStationId === id);
    if (!station) {
      return;
    }
    station.speed = value;
    const marker = station.marker;
    const icon = makeIcon(station);
    marker.setIcon(icon);
  }
};

client.onConnected = (reconnect, uri) => {
  console.log(reconnect, uri);
}

client.disconnectedPublishing = true;
client.onConnectionLost = async () => {
  console.log('Connection lost');
  setTimeout(async () => {
    await connect(client);
    await subscribeAll(client);
  }, 3000);
};
(async () => {
  try {
    stations = await fetchStations();
    updateStations();

    console.log('connecting...')
    await connect(client);
    await subscribeAll(client);
  } catch (err) {
    console.error(err);
  }
})();
