export function getConditions(args: { city: string }): string {
  const validCities = ["London", "Paris", "New York", "Tokyo", "Sydney"];

  if (!validCities.includes(args.city)) {
    return `Unknown city ${args.city}`;
  }

  const conditions = ["sunny", "cloudy", "rainy", "snowy"];
  return conditions[Math.floor(Math.random() * conditions.length)];
}

export function getTemperature(args: { city: string }): string {
  const validCities = ["London", "Paris", "New York", "Tokyo", "Sydney"];

  if (!validCities.includes(args.city)) {
    return `Unknown city ${args.city}`;
  }

  return `${Math.floor(Math.random() * 36)} degrees Celsius`;
}

export const availableFunctions: Record<string, (args: any) => any> = {
  getConditions,
  getTemperature,
};

export default availableFunctions;
