/**
 * Global Place Search using Multiple Free Providers
 * Providers: Nominatim + Photon (in parallel)
 */

const searchCache = new Map();

// Helper to normalize strings (lowercase, replace punctuation, collapse spaces)
function normalizeStr(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[.,\-\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function rankResult(result, rawQuery) {
  const query = normalizeStr(rawQuery);
  const name = normalizeStr(result.name);
  const address = normalizeStr(result.address);
  const fullName = name + ' ' + address;
  
  const queryTokens = query.split(' ').filter(Boolean);
  const nameTokens = name.split(' ').filter(Boolean);
  const addressTokens = address.split(' ').filter(Boolean);
  const fullTokens = [...nameTokens, ...addressTokens];
  
  let score = 0;

  // 1. Full normalized query match (Exact name match)
  if (name === query) {
    score += 1000;
  }
  
  // 2. Full phrase match (query appears contiguously in the name or address)
  if (name.includes(query)) {
    score += 500;
  } else if (address.includes(query)) {
    score += 100;
  }
  
  // 3. Token coverage (how many query words appear in the result)
  let matchedTokens = 0;
  let meaningfulTokens = 0; // words other than "the", "a", "of", "in"
  
  const stopWords = new Set(['the', 'a', 'an', 'of', 'in', 'at', 'by', 'for', 'with', 'on']);
  
  for (const token of queryTokens) {
    const isStopWord = stopWords.has(token);
    if (!isStopWord) meaningfulTokens++;
    
    if (nameTokens.includes(token)) {
      matchedTokens++;
      score += isStopWord ? 5 : 50; // Big boost for meaningful word in name
    } else if (addressTokens.includes(token)) {
      matchedTokens++;
      score += isStopWord ? 2 : 20; // Medium boost for meaningful word in address
    }
  }

  // Penalty for generic single-word matches
  // If user typed 3 meaningful words, but result only matches 1, heavily penalize it.
  if (meaningfulTokens > 1) {
    let matchedMeaningful = 0;
    for (const token of queryTokens) {
      if (!stopWords.has(token) && fullTokens.includes(token)) {
        matchedMeaningful++;
      }
    }
    if (matchedMeaningful === 1) {
      score -= 300; // Strong penalty so "Solitaire" doesn't outrank multi-word matches
    }
  }

  // 4. Location Context in Query
  // If the query contains known cities, and the result is in that city, boost it.
  const locationKeywords = ['gurgaon', 'gurugram', 'faridabad', 'delhi', 'new delhi', 'mumbai', 'singapore', 'dubai', 'new york'];
  for (const loc of locationKeywords) {
    if (query.includes(loc) && address.includes(loc)) {
      score += 200; // Found the requested locality!
    }
  }

  // 5. Category/Type relevance (Landmarks, airports, stations get a baseline boost so they float up)
  if (result.type === 'aeroway' || result.category === 'aeroway') score += 50;
  if (result.type === 'railway' || result.category === 'railway') score += 40;
  if (result.type === 'tourism' || result.category === 'tourism') score += 30;
  if (result.type === 'city' || result.type === 'administrative') score += 20;

  return score;
}

/**
 * Deduplicate results based on name and coordinates.
 * ~100m distance combined with similar names.
 */
function deduplicateResults(results) {
  const unique = [];
  
  for (const res of results) {
    const isDuplicate = unique.some(u => {
      const name1 = normalizeStr(u.name);
      const name2 = normalizeStr(res.name);
      
      // Rough name similarity (one contains the other)
      const nameMatch = name1.includes(name2) || name2.includes(name1);
      
      // Rough approximation: 0.001 degrees is roughly 100m
      const latDiff = Math.abs(u.lat - res.lat);
      const lonDiff = Math.abs(u.lon - res.lon);
      const isClose = latDiff < 0.0015 && lonDiff < 0.0015;
      
      return nameMatch && isClose;
    });
    
    if (!isDuplicate) {
      unique.push(res);
    }
  }
  
  return unique;
}

async function searchNominatim(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&addressdetails=1&limit=10`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Naksh-ETA-Monitor/1.0" }
    });
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.map(item => {
      const name = item.name || (item.address && (item.address.road || item.address.suburb || item.address.village)) || "Unknown Place";
      let addressParts = [];
      if (item.address) {
        if (item.address.city || item.address.town || item.address.village) {
          addressParts.push(item.address.city || item.address.town || item.address.village);
        }
        if (item.address.state) addressParts.push(item.address.state);
        if (item.address.country && addressParts.length < 2) addressParts.push(item.address.country);
      }
      
      const address = addressParts.length > 0 ? addressParts.join(', ') : item.display_name.split(',').slice(1).join(',').trim();
      
      return {
        id: `nom_${item.place_id}`,
        name,
        address: address || item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        type: item.type,
        category: item.category,
        source: 'nominatim'
      };
    });
  } catch (error) {
    console.error("Nominatim search error:", error);
    return [];
  }
}

async function searchPhoton(query) {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=10`;
    const response = await fetch(url);
    if (!response.ok) return [];
    
    const data = await response.json();
    if (!data.features) return [];
    
    return data.features.map(feature => {
      const p = feature.properties;
      const coords = feature.geometry.coordinates; // [lon, lat]
      
      const name = p.name || p.street || p.city || p.state || "Unknown Place";
      
      let addressParts = [];
      if (p.street && p.name && p.name !== p.street) addressParts.push(p.street);
      if (p.city || p.town || p.village) addressParts.push(p.city || p.town || p.village);
      if (p.state) addressParts.push(p.state);
      if (p.country && addressParts.length < 3) addressParts.push(p.country);
      
      const address = addressParts.join(', ');
      
      return {
        id: `pho_${p.osm_id || Math.random().toString(36).substr(2, 9)}`,
        name,
        address: address || p.country || '',
        lat: coords[1],
        lon: coords[0],
        type: p.osm_value,
        category: p.osm_key,
        source: 'photon'
      };
    });
  } catch (error) {
    console.error("Photon search error:", error);
    return [];
  }
}

export async function searchLocation(query) {
  if (!query || query.trim().length < 2) return [];
  
  const cacheKey = query.toLowerCase().trim();
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }
  
  try {
    // Run both providers in parallel
    const [nomResults, phoResults] = await Promise.all([
      searchNominatim(query),
      searchPhoton(query)
    ]);
    
    // Combine results
    let combined = [...nomResults, ...phoResults];
    
    // Score results
    combined.forEach(res => {
      res.score = rankResult(res, query);
    });
    
    // Filter out utterly terrible matches (negative scores caused by massive penalties)
    combined = combined.filter(res => res.score > -100);
    
    // Sort by score descending
    combined.sort((a, b) => b.score - a.score);
    
    // Deduplicate
    const unique = deduplicateResults(combined);
    
    // Limit to top 10
    const finalResults = unique.slice(0, 10);
    
    // Cache the result (keep cache size bounded)
    if (searchCache.size > 100) {
      const firstKey = searchCache.keys().next().value;
      searchCache.delete(firstKey);
    }
    searchCache.set(cacheKey, finalResults);
    
    return finalResults;
  } catch (error) {
    console.error("Geocoding aggregate error:", error);
    return [];
  }
}

export async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Naksh-ETA-Monitor/1.0" }
    });
    
    if (!response.ok) throw new Error("Reverse geocoding failed");
    
    const item = await response.json();
    
    const name = item.name || (item.address && (item.address.road || item.address.suburb || item.address.village)) || "Current Location";
    
    let addressParts = [];
    if (item.address) {
      if (item.address.city || item.address.town || item.address.village) {
        addressParts.push(item.address.city || item.address.town || item.address.village);
      }
      if (item.address.state) addressParts.push(item.address.state);
    }
    
    const address = addressParts.length > 0 ? addressParts.join(', ') : item.display_name.split(',').slice(1).join(',').trim();
    
    return {
      name,
      address: address || item.display_name,
      lat,
      lon
    };
  } catch (error) {
    console.error("Reverse geocoding error:", error);
    return null;
  }
}
