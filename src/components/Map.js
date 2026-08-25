"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icons in Next.js
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom map bounder component
function MapBounder({ origin, destination, routeGeoJSON }) {
  const map = useMap();
  
  useEffect(() => {
    if (routeGeoJSON && routeGeoJSON.coordinates) {
      // routeGeoJSON coordinates from OSRM are [lon, lat], Leaflet needs [lat, lon]
      const latLngs = routeGeoJSON.coordinates.map(coord => [coord[1], coord[0]]);
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (origin && destination) {
      const bounds = L.latLngBounds([origin, destination]);
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (origin) {
      map.setView(origin, 14);
    } else if (destination) {
      map.setView(destination, 14);
    }
  }, [origin, destination, routeGeoJSON, map]);

  return null;
}

export default function Map({ origin, destination, routeGeoJSON }) {
  // Default center (New Delhi)
  const defaultCenter = [28.6139, 77.2090];
  
  // Format geojson to leaflet polyline format ([lat, lon] array)
  let polylineCoords = [];
  if (routeGeoJSON && routeGeoJSON.coordinates) {
    polylineCoords = routeGeoJSON.coordinates.map(coord => [coord[1], coord[0]]);
  }

  return (
    <MapContainer 
      center={defaultCenter} 
      zoom={11} 
      style={{ height: "100%", width: "100%", zIndex: 0 }}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      
      {origin && (
        <Marker position={origin}>
          <Popup>Origin</Popup>
        </Marker>
      )}
      
      {destination && (
        <Marker position={destination}>
          <Popup>Destination</Popup>
        </Marker>
      )}

      {polylineCoords.length > 0 && (
        <Polyline 
          positions={polylineCoords} 
          pathOptions={{ color: "#7b61ff", weight: 5, opacity: 0.8 }} 
        />
      )}

      <MapBounder origin={origin} destination={destination} routeGeoJSON={routeGeoJSON} />
    </MapContainer>
  );
}
