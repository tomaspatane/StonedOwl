import { normalize } from './articles.js';

const COMMON_INCIDENTS = [
  /\b(demora(?:s)?|retraso(?:s)?|interrupci[oó]n|interrumpid[oa]s?|suspendid[oa]s?|suspensi[oó]n|cierre|cierra|cierran|cerrara|cerraran|cerrad[oa]s?|corte(?:s)?|falla(?:s)?|aver[ií]a(?:s)?|problema(?:s)?|reclamo(?:s)?|queja(?:s)?|paro(?:s)?|huelga(?:s)?|conflicto(?:s)?|incidente(?:s)?|colapso|saturad[oa]s?|faltante(?:s)?|falta de|sin servicio|no funciona|no funcionan|desborde(?:s)?|inundaci[oó]n|anegad[oa]s?|derrumbe(?:s)?|desalojo(?:s)?|usurpaci[oó]n)\b/,
  /\b(denuncian?|advierten?|reclaman?|protestan?|cancelad[oa]s?|evacua(?:do|da|dos|das)|demorado|demorada|robo(?:s)?|asalto(?:s)?|homicidio(?:s)?|balacera(?:s)?|tiroteo(?:s)?|violencia)\b/
];

const MONITOR_INCIDENTS = {
  'hospitales-caba': [
    /\b(guardia(?:s)?|turno(?:s)?|m[eé]dic[oa]s?|enfermer[oa]s?|insumo(?:s)?|medicamento(?:s)?|cama(?:s)?|ambulancia(?:s)?|quir[oó]fano(?:s)?)\b/,
    /\b(sin (?:m[eé]dicos|insumos|medicamentos|turnos|camas)|espera(?:s)?|atenci[oó]n demorada)\b/
  ],
  'salud-caba': [
    /\b(same|cesac|hospital(?:es)?|vacuna(?:s)?|dengue|guardia(?:s)?|turno(?:s)?|salud mental)\b/
  ],
  'subte-caba': [
    /\b(subte|l[ií]nea [a-h]|estaci[oó]n|estaciones|formaci[oó]n|and[eé]n|servicio)\b/,
    /\b(se[ñn]alizaci[oó]n|v[ií]as?|trenes?|frecuencia)\b/
  ],
  'servicios-caba': [
    /\b(luz|electricidad|edenor|edesur|agua|aysa|gas|metrogas|internet|fibra|servicio(?:s)?|sem[aá]foro(?:s)?|alumbrado)\b/
  ],
  'educacion-caba': [
    /\b(escuela(?:s)?|colegio(?:s)?|jard[ií]n|docente(?:s)?|clase(?:s)?|alumno(?:s)?|estudiante(?:s)?|comedor(?:es)?|vacante(?:s)?|infraestructura escolar)\b/
  ],
  'seguridad-caba': [
    /\b(seguridad|polic[ií]a|comisar[ií]a|robo(?:s)?|asalto(?:s)?|homicidio(?:s)?|arma(?:s)?|motochorro(?:s)?|entradera(?:s)?|arrebato(?:s)?|delito(?:s)?)\b/
  ],
  'limpieza-caba': [
    /\b(basura|residuo(?:s)?|contenedor(?:es)?|recolecci[oó]n|limpieza|barrido|microbasural(?:es)?|suciedad|vereda(?:s)?)\b/
  ],
  'vivienda-obras-caba': [
    /\b(vivienda(?:s)?|obra(?:s)?|edificio(?:s)?|construcci[oó]n|demolici[oó]n|derrumbe(?:s)?|desalojo(?:s)?|alquiler(?:es)?|inquilin(?:o|a|os|as)|urbanizaci[oó]n)\b/
  ],
  'espacio-publico-caba': [
    /\b(plaza(?:s)?|parque(?:s)?|vereda(?:s)?|calle(?:s)?|avenida(?:s)?|bici(?:senda|senda)?|arbolado|[aá]rbol(?:es)?|mobiliario urbano|espacio p[uú]blico)\b/
  ]
};

export function incidentRelevant(article, monitorId) {
  const text = normalize(`${article?.title || ''} ${article?.description || ''}`);
  if (!text) return false;
  const hasIncident = COMMON_INCIDENTS.some(pattern => pattern.test(text));
  if (!hasIncident) return false;
  const domainPatterns = MONITOR_INCIDENTS[monitorId];
  if (!domainPatterns) return true;
  return domainPatterns.some(pattern => pattern.test(text));
}

export function filterIncidentArticles(articles, monitorId) {
  return Array.isArray(articles) ? articles.filter(article => incidentRelevant(article, monitorId)) : [];
}
