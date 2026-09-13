/**
 * Lucide icons as inline SVG strings. Imported raw so they ship inside the bundle
 * (no sprite request) and inherit `currentColor`.
 */
import bike from "lucide-static/icons/bike.svg?raw";
import calendarClock from "lucide-static/icons/calendar-clock.svg?raw";
import car from "lucide-static/icons/car.svg?raw";
import chevronUp from "lucide-static/icons/chevron-up.svg?raw";
import list from "lucide-static/icons/list.svg?raw";
import signpost from "lucide-static/icons/signpost.svg?raw";
import arrowLeft from 'lucide-static/icons/arrow-left.svg?raw';
import arrowUpDown from 'lucide-static/icons/arrow-up-down.svg?raw';
import calendar from 'lucide-static/icons/calendar.svg?raw';
import carFront from 'lucide-static/icons/car-front.svg?raw';
import check from 'lucide-static/icons/check.svg?raw';
import chevronDown from 'lucide-static/icons/chevron-down.svg?raw';
import chevronLeft from 'lucide-static/icons/chevron-left.svg?raw';
import chevronRight from 'lucide-static/icons/chevron-right.svg?raw';
import circleAlert from 'lucide-static/icons/circle-alert.svg?raw';
import circleDot from 'lucide-static/icons/circle-dot.svg?raw';
import clock from 'lucide-static/icons/clock.svg?raw';
import construction from 'lucide-static/icons/construction.svg?raw';
import copy from 'lucide-static/icons/copy.svg?raw';
import externalLink from 'lucide-static/icons/external-link.svg?raw';
import eye from 'lucide-static/icons/eye.svg?raw';
import flag from 'lucide-static/icons/flag.svg?raw';
import gauge from 'lucide-static/icons/gauge.svg?raw';
import info from 'lucide-static/icons/info.svg?raw';
import layers from 'lucide-static/icons/layers.svg?raw';
import mapPin from 'lucide-static/icons/map-pin.svg?raw';
import menu from 'lucide-static/icons/menu.svg?raw';
import milestone from 'lucide-static/icons/milestone.svg?raw';
import moon from 'lucide-static/icons/moon.svg?raw';
import navigation from 'lucide-static/icons/navigation.svg?raw';
import octagonX from 'lucide-static/icons/octagon-x.svg?raw';
import refreshCw from 'lucide-static/icons/refresh-cw.svg?raw';
import route from 'lucide-static/icons/route.svg?raw';
import search from 'lucide-static/icons/search.svg?raw';
import share2 from 'lucide-static/icons/share-2.svg?raw';
import ship from 'lucide-static/icons/ship.svg?raw';
import slidersHorizontal from 'lucide-static/icons/sliders-horizontal.svg?raw';
import sun from 'lucide-static/icons/sun.svg?raw';
import timer from 'lucide-static/icons/timer.svg?raw';
import trafficCone from 'lucide-static/icons/traffic-cone.svg?raw';
import triangleAlert from 'lucide-static/icons/triangle-alert.svg?raw';
import truck from 'lucide-static/icons/truck.svg?raw';
import x from 'lucide-static/icons/x.svg?raw';

/** Strip the licence comment and the fixed 24px size so CSS controls dimensions. */
function prep(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace(/\s+width="24"/, '')
    .replace(/\s+height="24"/, '')
    .replace(/stroke-width="2"/, 'stroke-width="1.75"')
    .replace(/<svg/, '<svg aria-hidden="true" focusable="false"')
    .trim();
}

export const ICONS = {
  arrowLeft: prep(arrowLeft),
  signpost: prep(signpost),
  list: prep(list),
  chevronUp: prep(chevronUp),
  car: prep(car),
  calendarClock: prep(calendarClock),
  bike: prep(bike),
  arrowUpDown: prep(arrowUpDown),
  calendar: prep(calendar),
  carFront: prep(carFront),
  check: prep(check),
  chevronDown: prep(chevronDown),
  chevronLeft: prep(chevronLeft),
  chevronRight: prep(chevronRight),
  circleAlert: prep(circleAlert),
  circleDot: prep(circleDot),
  clock: prep(clock),
  construction: prep(construction),
  copy: prep(copy),
  externalLink: prep(externalLink),
  eye: prep(eye),
  flag: prep(flag),
  gauge: prep(gauge),
  info: prep(info),
  layers: prep(layers),
  mapPin: prep(mapPin),
  menu: prep(menu),
  milestone: prep(milestone),
  moon: prep(moon),
  navigation: prep(navigation),
  octagonX: prep(octagonX),
  refreshCw: prep(refreshCw),
  route: prep(route),
  search: prep(search),
  share2: prep(share2),
  ship: prep(ship),
  slidersHorizontal: prep(slidersHorizontal),
  sun: prep(sun),
  timer: prep(timer),
  trafficCone: prep(trafficCone),
  triangleAlert: prep(triangleAlert),
  truck: prep(truck),
  x: prep(x),
} as const;

export type IconName = keyof typeof ICONS;

/** Returns the icon wrapped in a span with the `icon` class for consistent sizing. */
export function icon(name: IconName, extraClass = ''): string {
  return `<span class="icon${extraClass ? ` ${extraClass}` : ''}">${ICONS[name]}</span>`;
}
