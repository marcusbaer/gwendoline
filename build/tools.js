export function getConditions(args) {
    const validCities = ["London", "Paris", "New York", "Tokyo", "Sydney"];
    if (!validCities.includes(args.city)) {
        return "Unknown city";
    }
    const conditions = ["sunny", "cloudy", "rainy", "snowy"];
    return conditions[Math.floor(Math.random() * conditions.length)];
}
export function getTemperature(args) {
    const validCities = ["London", "Paris", "New York", "Tokyo", "Sydney"];
    if (!validCities.includes(args.city)) {
        return `Unknown city ${args.city}`;
    }
    return `${Math.floor(Math.random() * 36)} degrees Celsius`;
}
export const availableFunctions = {
    getConditions,
    getTemperature,
};
export default availableFunctions;
