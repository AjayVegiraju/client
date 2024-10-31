// client/src/components/AzureMapComponent.js

import React, { useEffect, useRef, useState } from "react";
import * as atlas from "azure-maps-control";
import io from "socket.io-client";
import {
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from "@mui/material";

const mapSubscriptionKey = "EN5vcaicwC78zKi3M3980VVB1m7DuuN0vKaDMtYdjBg7daKhx3OTJQQJ99AHAC8vTIngVrqvAAAgAZMPLtXG";

const AzureMapComponent = () => {
  const mapRef = useRef(null);
  const dataSourceRef = useRef(null);
  const initializedRef = useRef(false);
  const [pins, setPins] = useState([]);
  const [selectedPin, setSelectedPin] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Updated state to include Gated/Fenced filter
  const [statusFilters, setStatusFilters] = useState({
    Green: false,
    Yellow: false,
    Red: false,
    GatedFenced: false,
  });

  const socketRef = useRef(null);

  const handleStatusFilterChange = (event) => {
    const { name, checked } = event.target;
    setStatusFilters((prevFilters) => ({
      ...prevFilters,
      [name]: checked,
    }));
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setSelectedPin(null);
  };

  useEffect(() => {
    // Initialize Socket.IO connection
    socketRef.current = io("http://localhost:5001");

    // Listen for map data updates
    socketRef.current.on("mapDataUpdate", (data) => {
      console.log("Received data from server:", data); // Debugging
      setPins(data);
    });

    // Clean up on unmount
    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!initializedRef.current) {
      const azureMap = new atlas.Map("azureMapContainer", {
        center: [-74.006, 40.7128], // Default center (New York City)
        zoom: 8,
        view: "Auto",
        authOptions: {
          authType: "subscriptionKey",
          subscriptionKey: mapSubscriptionKey,
        },
      });

      azureMap.events.add("ready", () => {
        const dataSource = new atlas.source.DataSource(null, {
          cluster: true,
          clusterRadius: 45,
        });

        azureMap.sources.add(dataSource);
        dataSourceRef.current = dataSource;

        const loadImageToMap = (map, id, url) => {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
              map.imageSprite.add(id, img).then(resolve).catch(reject);
            };
            img.onerror = (err) => {
              console.error(`Failed to load image ${id} from ${url}`, err);
              reject(err);
            };
            img.src = url;
          });
        };

        Promise.all([
          loadImageToMap(azureMap, "green-pin", "/icons/green-pin.png"),
          loadImageToMap(azureMap, "yellow-pin", "/icons/yellow-pin.png"),
          loadImageToMap(azureMap, "red-pin", "/icons/red-pin.png"),
          loadImageToMap(
            azureMap,
            "green-pin-fence",
            "/icons/green-pin-fence.png"
          ),
          loadImageToMap(
            azureMap,
            "yellow-pin-fence",
            "/icons/yellow-pin-fence.png"
          ),
          loadImageToMap(azureMap, "red-pin-fence", "/icons/red-pin-fence.png"),
        ])
          .then(() => {
            // Add clustered layers
            azureMap.layers.add(
              new atlas.layer.BubbleLayer(dataSource, null, {
                filter: ["has", "point_count"],
                radius: ["step", ["get", "point_count"], 10, 100, 15, 750, 20],
                color: [
                  "step",
                  ["get", "point_count"],
                  "lightblue",
                  100,
                  "green",
                  750,
                  "red",
                ],
                strokeWidth: 2,
                strokeColor: "white",
              })
            );

            azureMap.layers.add(
              new atlas.layer.SymbolLayer(dataSource, null, {
                filter: ["has", "point_count"],
                iconOptions: { image: "none" },
                textOptions: {
                  textField: "{point_count_abbreviated}",
                  offset: [0, 0.4],
                  color: "black",
                  font: ["StandardFont-Bold"],
                  size: 12,
                },
              })
            );

            // Create the unclustered pins SymbolLayer
            const symbolLayer = new atlas.layer.SymbolLayer(dataSource, null, {
              filter: ["!", ["has", "point_count"]],
              iconOptions: {
                image: ["get", "image"],
                allowOverlap: true,
                size: 0.7,
              },
            });

            azureMap.layers.add(symbolLayer);

            // Add click event listener to the symbol layer
            azureMap.events.add("click", symbolLayer, (e) => {
              if (e.shapes && e.shapes.length > 0) {
                const shape = e.shapes[0];
                let properties;

                if (typeof shape.getProperties === "function") {
                  properties = shape.getProperties();
                } else {
                  properties = shape.properties;
                }

                setSelectedPin(properties);
                setDialogOpen(true);
              }
            });

            initializedRef.current = true;
            mapRef.current = azureMap;
          })
          .catch((err) => {
            console.error("Error loading images:", err);
          });
      });
    }
  }, []);

  // Update the map when status filters or pins change
  useEffect(() => {
    if (dataSourceRef.current) {
      if (pins.length > 0) {
        populatePins(pins);
      } else {
        dataSourceRef.current.clear();
      }
    }
  }, [pins, statusFilters]);

  const getImageFromStatus = (statusReasonValue, gatedFenced) => {
    const isGated = gatedFenced && gatedFenced.trim().toUpperCase() === "Y";
    let imageId = "";

    switch (statusReasonValue) {
      case "1": // In Progress Deals
        imageId = isGated ? "yellow-pin-fence" : "yellow-pin";
        break;
      case "2": // Lost Deals
        imageId = isGated ? "red-pin-fence" : "red-pin";
        break;
      case "100000000": // Won Deals
        imageId = isGated ? "green-pin-fence" : "green-pin";
        break;
      default:
        imageId = isGated ? "yellow-pin-fence" : "yellow-pin";
        break;
    }

    return imageId;
  };

  const populatePins = (pinsData) => {
    const anyStatusSelected = Object.keys(statusFilters)
      .filter((key) => key !== "GatedFenced")
      .some((key) => statusFilters[key]);

    const isGatedFencedFilterActive = statusFilters.GatedFenced;

    const features = pinsData
      .filter((pin) => {
        const statusReasonValue = pin.StatusReason;
        const gatedFenced =
          pin["Gated/Fenced"] &&
          pin["Gated/Fenced"].trim().toUpperCase() === "Y";

        // Filter by status
        let statusMatch = true;
        if (anyStatusSelected) {
          statusMatch = false;
          if (statusFilters.Green && statusReasonValue === "100000000")
            statusMatch = true;
          if (statusFilters.Red && statusReasonValue === "2")
            statusMatch = true;
          if (statusFilters.Yellow && statusReasonValue === "1")
            statusMatch = true;
        }

        // Filter by Gated/Fenced
        let gatedFencedMatch = true;
        if (isGatedFencedFilterActive) {
          gatedFencedMatch = gatedFenced;
        }

        return statusMatch && gatedFencedMatch;
      })
      .map((pin) => {
        // Adjust property names based on actual data
        const latValue = pin.Latitude;
        const lonValue = pin.Longitude;

        if (latValue == null || lonValue == null) {
          console.warn(
            `Skipping pin with missing coordinates: ${
              pin.PropertyAddress || "Unknown"
            }`
          );
          return null; // Skip pins with missing coordinates
        }

        const lat = parseFloat(latValue.toString().trim());
        const lon = parseFloat(lonValue.toString().trim());

        if (isNaN(lat) || isNaN(lon)) {
          console.error(
            `Invalid coordinates for pin: ${latValue}, ${lonValue}`
          );
          return null; // Skip invalid pins
        }

        const statusReasonValue = pin.StatusReason;
        const gatedFenced = pin["Gated/Fenced"];

        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lon, lat],
          },
          properties: {
            StatusReasonValue: statusReasonValue,
            GatedFenced: gatedFenced,
            Name: pin.PropertyAddress,
            Description: `State: ${pin.State}, Zip: ${pin.Zip}`,
            image: getImageFromStatus(statusReasonValue, gatedFenced),
          },
        };
      })
      .filter(Boolean); // Remove null values

    dataSourceRef.current.clear(); // Clear old features
    dataSourceRef.current.add(features); // Add new features
  };

  return (
    <div>
      <h2>Azure Maps Dashboard</h2>
      <div>
        <FormControlLabel
          control={
            <Checkbox
              name="Green"
              checked={statusFilters.Green}
              onChange={handleStatusFilterChange}
            />
          }
          label="Green"
        />
        <FormControlLabel
          control={
            <Checkbox
              name="Yellow"
              checked={statusFilters.Yellow}
              onChange={handleStatusFilterChange}
            />
          }
          label="Yellow"
        />
        <FormControlLabel
          control={
            <Checkbox
              name="Red"
              checked={statusFilters.Red}
              onChange={handleStatusFilterChange}
            />
          }
          label="Red"
        />
        <FormControlLabel
          control={
            <Checkbox
              name="GatedFenced"
              checked={statusFilters.GatedFenced}
              onChange={handleStatusFilterChange}
            />
          }
          label="Gated/Fenced"
        />
      </div>
      <div
        id="azureMapContainer"
        style={{ width: "100%", height: "500px" }}
      ></div>

      {/* Dialog for pin details */}
      <Dialog open={dialogOpen} onClose={handleDialogClose}>
        <DialogTitle>
          {selectedPin ? selectedPin.Name || "Pin Details" : "Pin Details"}
        </DialogTitle>
        <DialogContent>
          {selectedPin && (
            <>
              <DialogContentText>
                Status Reason Value: {selectedPin.StatusReasonValue}
              </DialogContentText>
              <DialogContentText>
                Gated/Fenced: {selectedPin.GatedFenced || "N/A"}
              </DialogContentText>
              <DialogContentText>{selectedPin.Description}</DialogContentText>
              {/* Include other details as needed */}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDialogClose} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default AzureMapComponent;
