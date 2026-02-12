export function getConditions(args: { city: string }): string {
  const validCities = ["London", "Paris", "New York", "Tokyo", "Sydney"];
  if (!validCities.includes(args.city)) {
    return `Unknown city ${args.city}`;
  }
  const conditions = ["sunny", "cloudy", "rainy", "snowy"];
  const pickedCondition =
    conditions[Math.floor(Math.random() * conditions.length)];
  return `Weather condition in ${args.city} is ${pickedCondition}.`;
}

export function getTemperature(args: { city: string }): string {
  const validCities = ["London", "Paris", "New York", "Tokyo", "Sydney"];
  if (!validCities.includes(args.city)) {
    return `Unknown city ${args.city}`;
  }
  return `Temperature in ${args.city} is ${Math.floor(Math.random() * 36)} degrees Celsius.`;
}

export const availableFunctions = {
  getConditions,
  getTemperature,
};

export default availableFunctions;
