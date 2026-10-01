const groups = [
  {
    subfamily: 'corte', signalType: 'problem', weight: 3, tier: 'A', exact: true,
    phrases: [
      'sin luz','corte de luz','cortes de luz','apagón','apagones','corte eléctrico','corte de energía',
      'sin electricidad','sin energía','falta de luz','falta de electricidad','falta de suministro',
      'suministro cortado','servicio cortado','servicio interrumpido','interrupción del servicio'
    ]
  },
  {
    subfamily: 'experiencia_personal', signalType: 'personal_experience', weight: 4, tier: 'A', exact: true,
    phrases: [
      'se me cortó la luz','me quedé sin luz','estoy sin luz','no tengo luz','seguimos sin luz','sigo sin luz',
      'se volvió a cortar','volvió a cortarse','todavía no volvió','no volvió la luz','no vuelve la luz',
      'recién se cortó','otra vez me quedé sin luz','estamos sin luz','nos quedamos sin luz','no tenemos luz'
    ]
  },
  {
    subfamily: 'escala_colectiva', signalType: 'scale', weight: 4, tier: 'A', exact: true,
    phrases: [
      'toda la cuadra sin luz','edificio sin luz','barrio sin luz','vecinos sin luz','comercios sin luz',
      'varias cuadras sin luz','toda la manzana sin luz','media zona sin luz','todo el edificio sin luz'
    ]
  },
  {
    subfamily: 'tension', signalType: 'problem', weight: 3, tier: 'B', exact: true,
    phrases: [
      'baja tensión','tensión baja','poca tensión','problemas de tensión','variaciones de tensión',
      'sube y baja la tensión','pico de tensión','sobretensión','caída de tensión','voltaje bajo','voltaje inestable'
    ]
  },
  {
    subfamily: 'microcortes', signalType: 'problem', weight: 3, tier: 'B', exact: true,
    phrases: [
      'microcorte','microcortes','cortes intermitentes','se corta a cada rato','se corta y vuelve',
      'se prende y apaga','parpadea la luz','cortes de segundos','cortes todo el tiempo','luz intermitente'
    ]
  },
  {
    subfamily: 'infraestructura', signalType: 'infrastructure', weight: 4, tier: 'A', exact: false,
    phrases: [
      'transformador','transformador quemado','explotó un transformador','se quemó un transformador',
      'cable caído','cable cortado','cables quemados','poste caído','poste roto','subestación',
      'cámara eléctrica','tablero eléctrico','explosión eléctrica','chispazos','cables haciendo chispas'
    ]
  },
  {
    subfamily: 'consecuencia', signalType: 'consequence', weight: 4, tier: 'B', exact: true,
    phrases: [
      'se quemó la heladera','se me quemó la heladera','se quemaron los electrodomésticos','perdí la comida',
      'comida echada a perder','no funciona el ascensor','ascensor parado','no funciona la bomba de agua',
      'edificio sin agua por falta de luz','semáforo apagado','semáforos apagados','calle a oscuras',
      'comercios cerrados por falta de luz','local sin luz','escuela sin luz','hospital sin luz'
    ]
  },
  {
    subfamily: 'persistencia', signalType: 'persistence', weight: 3, tier: 'B', exact: true,
    phrases: [
      'hace una hora','hace dos horas','hace horas','desde ayer','desde anoche','desde esta mañana',
      'desde la madrugada','hace días','tercer día sin luz','segundo día sin luz','seguimos esperando','nunca volvió'
    ]
  },
  {
    subfamily: 'repeticion', signalType: 'repetition', weight: 3, tier: 'B', exact: true,
    phrases: [
      'otra vez sin luz','nuevamente sin luz','todos los días se corta','se corta siempre','otra vez un corte',
      'cada vez que hace calor','cortes todos los días','cortes constantes','corte tras corte'
    ]
  },
  {
    subfamily: 'reclamo', signalType: 'confirmation', weight: 2, tier: 'B', exact: true,
    phrases: [
      'hice el reclamo','número de reclamo','reclamo sin respuesta','no toman el reclamo','no atienden',
      'nadie atiende','no responden','llamé mil veces','sin solución','seguimos esperando una respuesta'
    ]
  },
  {
    subfamily: 'empresa', signalType: 'entity', weight: 2, tier: 'B', exact: false,
    phrases: ['Edesur','Edenor','distribuidora','empresa eléctrica','servicio eléctrico']
  },
  {
    subfamily: 'calor', signalType: 'severity', weight: 2, tier: 'C', exact: true,
    phrases: ['con este calor sin luz','ola de calor sin luz','pleno verano sin luz','40 grados sin luz','calor y sin electricidad']
  },
  {
    subfamily: 'coloquial', signalType: 'context', weight: 1, tier: 'C', exact: true,
    phrases: ['se cortó todo','se apagó todo','estamos a oscuras','quedamos a oscuras','murió la luz','se cayó la luz','se cortó de nuevo','no hay corriente']
  }
];

export const ELECTRICIDAD_VOCAB = groups.flatMap((group, groupIndex) =>
  group.phrases.map((phrase, phraseIndex) => ({
    id: `elec_${String(groupIndex + 1).padStart(2, '0')}_${String(phraseIndex + 1).padStart(3, '0')}`,
    family: 'electricidad',
    subfamily: group.subfamily,
    phrase,
    signalType: group.signalType,
    baseWeight: group.weight,
    searchTier: group.tier,
    exactSearch: group.exact,
    requiresGeo: true,
    active: true,
    language: 'es-AR'
  }))
);

export const ELECTRICIDAD_NEGATIVE_TERMS = [
  'fotografía','fotografia','iluminación decorativa','iluminacion decorativa','lámpara','lampara','led',
  'mercadolibre','comprar','precio','electricista','tutorial','instalación eléctrica','instalacion electrica',
  'factura de luz','ahorro energético','ahorro energetico'
];

export const ELECTRICIDAD_QUERY_TERMS = [
  '"sin luz"','"corte de luz"','apagón','"baja tensión"','microcortes','transformador',
  '"estamos sin luz"','"no volvió la luz"','"otra vez sin luz"','Edesur','Edenor'
];

export function normalizeElectricText(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function matchElectricSignals(text = '') {
  const normalized = normalizeElectricText(text);
  if (ELECTRICIDAD_NEGATIVE_TERMS.some((term) => normalized.includes(normalizeElectricText(term)))) return [];
  return ELECTRICIDAD_VOCAB.filter((entry) => normalized.includes(normalizeElectricText(entry.phrase)));
}
