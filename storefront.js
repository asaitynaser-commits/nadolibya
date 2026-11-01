import { db } from "./firebase.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const container = $("productsContainer");
const searchInput = $("productSearch");
const categoryFilter = $("categoryFilter");
const cartDialog = $("cartDialog");

let products = [];
let cart = [];

function addTextElement(tag, text, className = "") {
  const element = document.createElement(tag);

  element.textContent = text;

  if (className) {
    element.className = className;
  }

  return element;
}

// تحميل المنتجات المنشورة من Firestore
async function loadProducts() {
  container.textContent = "جاري تحميل المنتجات...";

  try {
    const publishedQuery = query(
      collection(db, "products"),
      where("status", "==", "published")
    );

    const snapshot = await getDocs(publishedQuery);

    products = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    products.sort((a, b) => {
      const timeA = a.createdAt?.toMillis?.() || 0;
      const timeB = b.createdAt?.toMillis?.() || 0;

      return timeB - timeA;
    });

    buildCategories();
    renderProducts(products);

  } catch (error) {
    console.error("Storefront products error:", error);

    container.textContent =
      "تعذر تحميل المنتجات. تحقق من اتصال Firebase وقواعد Firestore.";
  }
}

// إنشاء التصنيفات تلقائياً
function buildCategories() {
  const categories = [
    ...new Set(
      products
        .map((item) => item.category)
        .filter(
          (item) =>
            typeof item === "string" &&
            item.trim()
        )
    )
  ];

  categoryFilter.innerHTML = "";

  categoryFilter.append(
    new Option("جميع التصنيفات", "all")
  );

  categories
    .sort((a, b) => a.localeCompare(b, "ar"))
    .forEach((category) => {
      categoryFilter.append(
        new Option(category, category)
      );
    });
}

// عرض المنتجات
function renderProducts(items) {
  container.innerHTML = "";

  if (!items.length) {
    container.append(
      addTextElement(
        "p",
        "لا توجد منتجات مطابقة حالياً.",
        "empty-products"
      )
    );

    return;
  }

  items.forEach((product) => {
    const card = document.createElement("article");

    card.className = "products-card";

    // شارة الجديد
    if (product.isNew === true) {
      card.append(
        addTextElement("span", "الجديد", "badge")
      );
    }

    // الصورة
    const imageBox = document.createElement("div");

    imageBox.className = "products-image";

    const image = document.createElement("img");

    image.loading = "lazy";
    image.alt = product.name || "منتج NADO LIBYA";

    if (
      typeof product.imageUrl === "string" &&
      /^https?:\/\//i.test(product.imageUrl)
    ) {
      image.src = product.imageUrl;
    }

    image.addEventListener("error", () => {
      image.removeAttribute("src");
      image.alt = "الصورة غير متوفرة";
    });

    imageBox.append(image);
    card.append(imageBox);

    // اسم المنتج
    card.append(
      addTextElement(
        "h3",
        product.name || "منتج جديد"
      )
    );

    // الوصف
    if (product.description) {
      card.append(
        addTextElement(
          "p",
          product.description,
          "product-description"
        )
      );
    }

    // الأسعار
    const priceWrap = document.createElement("div");

    priceWrap.className = "product-price";

    const price = Number(product.price);
    const sale = Number(product.salePrice);

    if (
      Number.isFinite(sale) &&
      sale > 0 &&
      Number.isFinite(price) &&
      sale < price
    ) {
      const oldPrice = document.createElement("del");

      oldPrice.textContent = `${price} LYD`;

      priceWrap.append(
        oldPrice,
        addTextElement(
          "strong",
          `${sale} LYD`
        )
      );

    } else {
      priceWrap.append(
        addTextElement(
          "strong",
          Number.isFinite(price)
            ? `${price} LYD`
            : "السعر غير متوفر"
        )
      );
    }

    card.append(priceWrap);

    // الكمية المتوفرة
    const stock = Math.max(
      0,
      Number(product.quantity) || 0
    );

    const addButton = addTextElement(
      "button",
      stock > 0 ? "أضف للسلة" : "غير متوفر",
      "add-to-cart"
    );

    addButton.type = "button";
    addButton.disabled = stock <= 0;

    addButton.addEventListener("click", () => {
      addToCart(product);
    });

    card.append(addButton);

    container.append(card);
  });
}

// البحث والتصفية
function filterProducts() {
  const term = searchInput.value
    .trim()
    .toLocaleLowerCase();

  const category = categoryFilter.value;

  const filtered = products.filter((item) => {
    const name = (
      `${item.name || ""} ${item.description || ""}`
    ).toLocaleLowerCase();

    return (
      name.includes(term) &&
      (
        category === "all" ||
        item.category === category
      )
    );
  });

  renderProducts(filtered);
}

// حساب السعر بعد التخفيض
function effectivePrice(product) {
  const price = Number(product.price);
  const sale = Number(product.salePrice);

  return (
    Number.isFinite(sale) &&
    sale > 0 &&
    sale < price
  )
    ? sale
    : price;
}

// إضافة منتج إلى السلة
function addToCart(product) {
  const stock = Math.max(
    0,
    Number(product.quantity) || 0
  );

  const current = cart.find(
    (item) => item.id === product.id
  );

  if (current && current.quantity >= stock) {
    alert("وصلت للكمية المتوفرة من هذا المنتج.");
    return;
  }

  if (!current && stock < 1) {
    alert("هذا المنتج غير متوفر حالياً.");
    return;
  }

  if (current) {
    current.quantity += 1;

  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: effectivePrice(product),
      quantity: 1,
      stock
    });
  }

  updateCart();
}

// تحديث السلة
function updateCart() {
  const itemsBox = $("cartItems");

  itemsBox.innerHTML = "";

  let count = 0;
  let total = 0;

  if (!cart.length) {
    itemsBox.append(
      addTextElement(
        "p",
        "السلة فارغة حالياً."
      )
    );
  }

  cart.forEach((item) => {
    count += item.quantity;

    total += item.price * item.quantity;

    const row = document.createElement("div");

    row.className = "cart-item";

    row.append(
      addTextElement("h3", item.name)
    );

    row.append(
      addTextElement(
        "p",
        `${item.price} LYD × ${item.quantity}`
      )
    );

    const actions = document.createElement("div");

    // زر زيادة الكمية
    const plus = addTextElement("button", "+");

    plus.type = "button";
    plus.setAttribute("aria-label", "زيادة الكمية");

    plus.addEventListener("click", () => {
      if (item.quantity < item.stock) {
        item.quantity += 1;

      } else {
        alert("لا توجد كمية إضافية متوفرة.");
      }

      updateCart();
    });

    // زر تقليل الكمية
    const minus = addTextElement("button", "−");

    minus.type = "button";
    minus.setAttribute("aria-label", "تقليل الكمية");

    minus.addEventListener("click", () => {
      item.quantity -= 1;

      if (item.quantity <= 0) {
        cart = cart.filter(
          (cartItem) => cartItem.id !== item.id
        );
      }

      updateCart();
    });

    // زر الحذف
    const remove = addTextElement("button", "حذف");

    remove.type = "button";

    remove.addEventListener("click", () => {
      cart = cart.filter(
        (cartItem) => cartItem.id !== item.id
      );

      updateCart();
    });

    actions.append(
      plus,
      minus,
      remove
    );

    row.append(actions);

    itemsBox.append(row);
  });

  $("cartCount").textContent = String(count);

  $("cartTotal").textContent =
    `${total.toLocaleString("en-US")} LYD`;
}

// أحداث البحث والتصفية
searchInput.addEventListener(
  "input",
  filterProducts
);

categoryFilter.addEventListener(
  "change",
  filterProducts
);

// فتح السلة
$("cartButton").addEventListener("click", () => {
  cartDialog.showModal();
});

// إغلاق السلة
$("closeCartButton").addEventListener("click", () => {
  cartDialog.close();
});

// متابعة الطلب - غير مربوط بحفظ طلب حقيقي حتى الآن
$("checkoutButton").addEventListener("click", () => {
  if (!cart.length) {
    $("cartMessage").textContent =
      "السلة فارغة حالياً.";

    return;
  }

  $("cartMessage").textContent =
    "السلة جاهزة. ربط تسجيل الطلبات والتحقق النهائي من المخزون سيكون في المرحلة التالية.";
});

// تشغيل الصفحة
updateCart();
loadProducts();