// Quick test for WebAgent improvements
const { WebAgent } = require('./agents/WebAgent');

async function testWebAgent() {
  console.log('Testing WebAgent with Amazon...');
  
  try {
    const result = await WebAgent({
      url: 'https://www.amazon.in/s?k=smartphones+under+20000',
      task: 'Extract product names and prices for phones listed under 20,000 INR'
    });
    
    console.log('WebAgent Result:', JSON.stringify(result, null, 2));
    
    if (result.isCompleted && result.result?.extractedData?.products) {
      console.log(`✅ Success! Found ${result.result.extractedData.products.length} products`);
      result.result.extractedData.products.slice(0, 3).forEach((product, i) => {
        console.log(`${i + 1}. ${product.name} - ${product.price || 'No price'}`);
      });
    } else {
      console.log('❌ WebAgent did not complete successfully');
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  testWebAgent();
}
